from datetime import timedelta
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from alembic.config import Config
from fastapi.testclient import TestClient

from alembic import command
from app.core.errors import NotFoundError
from app.core.security import utc_now
from app.home import service as home_service
from app.home.schemas import ReadActivities
from app.home.service import HomeService
from app.reminders.models import Reminder
from app.schedule.prompts import service as prompt_service
from tests.conftest import API, TEST_ORIGIN, TEST_PASSWORD
from tests.test_plan_prompts import NOW, act, activity, planned


def reminder(owner, channel, db, *, past=True):
    response = owner.post(
        f"{API}/channels/{channel['id']}/messages",
        json={
            "content": "Remember the backup",
            "reminder": {"due_at": (utc_now() + timedelta(days=1)).isoformat()},
        },
    )
    assert response.status_code == 201, response.text
    item = response.json()
    if past:
        record = db.get(Reminder, UUID(item["id"]))
        record.due_at = utc_now() - timedelta(minutes=5)
        db.commit()
    return item


def test_read_state_syncs_without_completing_a_reminder(owner, channel, db, app):
    item = reminder(owner, channel, db)
    reminder(owner, channel, db, past=False)
    page = owner.get(f"{API}/home/activity").json()
    assert len(page["items"]) == 1
    notification = page["items"][0]
    assert notification["read"] is False
    assert notification["channel_id"] == channel["id"]
    body = {"items": [{key: notification[key] for key in ("kind", "id", "revision")}]}
    assert owner.post(f"{API}/home/activity/read", json=body).status_code == 204
    with TestClient(app, base_url="http://localhost", headers={"Origin": TEST_ORIGIN}) as other:
        assert other.get(f"{API}/home/activity").status_code == 401
        assert (
            other.post(
                f"{API}/auth/login", json={"username": "ilya", "password": TEST_PASSWORD}
            ).status_code
            == 200
        )
        assert other.get(f"{API}/home/activity").json()["items"][0]["read"] is True
    db.expire_all()
    assert db.get(Reminder, UUID(item["id"])).status == "active"
    owner.delete(f"{API}/messages/{item['id']}")
    assert owner.get(f"{API}/home/activity").json()["items"] == []


def test_stale_read_does_not_acknowledge_a_new_reminder_revision(owner, channel, db):
    item = reminder(owner, channel, db)
    notification = owner.get(f"{API}/home/activity").json()["items"][0]
    body = {"items": [{key: notification[key] for key in ("kind", "id", "revision")}]}
    assert owner.post(f"{API}/home/activity/read", json=body).status_code == 204
    record = db.get(Reminder, UUID(item["id"]))
    record.revision += 1
    db.commit()
    assert owner.post(f"{API}/home/activity/read", json=body).status_code == 409
    assert owner.get(f"{API}/home/activity").json()["items"][0]["read"] is False
    with pytest.raises(NotFoundError):
        HomeService(db).read(uuid4(), ReadActivities.model_validate(body))
    db.rollback()
    with pytest.raises(NotFoundError):
        HomeService(db).activity(uuid4(), 50)


def test_plan_prompts_have_independent_read_state_and_snoozing_stays_on_schedule(
    owner, monkeypatch, db
):
    monkeypatch.setattr(prompt_service, "utc_now", lambda: NOW)
    monkeypatch.setattr(home_service, "utc_now", lambda: NOW)
    task = activity(owner, "Reading")
    plan = planned(owner, task["id"])
    notification = owner.get(f"{API}/home/activity").json()["items"][0]
    assert notification["kind"] == "plan"
    body = {"items": [{key: notification[key] for key in ("kind", "id", "revision")}]}
    assert owner.post(f"{API}/home/activity/read", json=body).status_code == 204
    prompt = owner.get(f"{API}/schedule/prompts").json()[0]
    assert prompt["status"] == "pending"
    assert act(owner, prompt, "delay", minutes=5, reason="Finishing a chapter").status_code == 200
    assert owner.get(f"{API}/home/activity").json()["items"] == []
    later = NOW + timedelta(minutes=6)
    monkeypatch.setattr(prompt_service, "utc_now", lambda: later)
    monkeypatch.setattr(home_service, "utc_now", lambda: later)
    assert owner.get(f"{API}/home/activity").json()["items"][0]["read"] is False
    assert owner.get(f"{API}/schedule/plans/{plan['id']}").json()["start_minute"] == 725


def test_activity_limit_and_batch_read_are_validated_atomically(owner, channel, db):
    reminder(owner, channel, db)
    reminder(owner, channel, db)
    page = owner.get(f"{API}/home/activity?limit=1").json()
    assert page["has_more"] is True
    valid = {key: page["items"][0][key] for key in ("kind", "id", "revision")}
    response = owner.post(
        f"{API}/home/activity/read",
        json={"items": [valid, {**valid, "id": str(uuid4())}]},
    )
    assert response.status_code == 404
    assert all(not item["read"] for item in owner.get(f"{API}/home/activity").json()["items"])
    assert owner.get(f"{API}/home/activity?limit=201").status_code == 422
    assert owner.post(f"{API}/home/activity/read", json={"items": []}).status_code == 422


def test_upgrade_keeps_existing_reminders_and_initializes_them_as_unread(
    owner, channel, db, engine
):
    item = reminder(owner, channel, db)
    config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    with engine.begin() as connection:
        config.attributes["connection"] = connection
        command.downgrade(config, "0012_channel_documents")
        command.upgrade(config, "head")
    page = owner.get(f"{API}/home/activity").json()
    assert page["items"][0]["id"] == item["id"]
    assert page["items"][0]["read"] is False
    assert db.get(Reminder, UUID(item["id"])).status == "active"
