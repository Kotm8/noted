import io
import json
import zipfile
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from sqlalchemy import func, select

from app.core.security import utc_now
from app.notes.models import Message
from app.publishing import service
from app.publishing.models import ScheduledMessage, WritingPrompt
from app.publishing.recurrence import next_occurrence
from app.publishing.schemas import WritingFields
from app.publishing.worker import advance_due
from tests.conftest import API
from tests.test_backups import export, upload

NOW = utc_now() + timedelta(days=2)


def scheduled(owner, channel, **values):
    response = owner.post(
        f"{API}/channels/{channel['id']}/scheduled-messages",
        json={
            "content": "A message for later",
            "send_at": (NOW + timedelta(seconds=10)).isoformat(),
            "timezone": "UTC",
            **values,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def writing(owner, channel, **values):
    response = owner.put(
        f"{API}/channels/{channel['id']}/writing-prompt",
        json={
            "content": "How was your day?",
            "start_at": (NOW + timedelta(seconds=10)).isoformat(),
            "timezone": "UTC",
            "frequency": "daily",
            **values,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_scheduled_message_publishes_once_at_its_time(owner, channel, engine, db, monkeypatch):
    monkeypatch.setattr(service, "utc_now", lambda: NOW)
    queued = scheduled(owner, channel)
    advance_due(engine, NOW + timedelta(seconds=5), NOW)
    assert owner.get(f"{API}/channels/{channel['id']}/messages").json()["items"] == []
    advance_due(engine, NOW + timedelta(seconds=10), NOW + timedelta(seconds=5))
    advance_due(engine, NOW + timedelta(seconds=15), NOW + timedelta(seconds=10))
    messages = owner.get(f"{API}/channels/{channel['id']}/messages").json()["items"]
    assert len(messages) == 1
    assert messages[0]["content"] == queued["content"]
    record = db.get(ScheduledMessage, UUID(queued["id"]))
    assert record.status == "sent"
    assert record.message_id == UUID(messages[0]["id"])


@pytest.mark.parametrize("previous", [None, NOW - timedelta(minutes=3)])
def test_downtime_skips_messages_and_prompt_occurrences(
    owner, channel, engine, db, monkeypatch, previous
):
    monkeypatch.setattr(service, "utc_now", lambda: NOW)
    queued = scheduled(owner, channel)
    prompt = writing(owner, channel)
    advance_due(engine, NOW + timedelta(seconds=20), previous)
    assert db.get(ScheduledMessage, UUID(queued["id"])).status == "skipped"
    rule = db.get(WritingPrompt, UUID(prompt["id"]))
    assert rule.due_at is None
    assert rule.next_at > NOW + timedelta(seconds=20)
    assert db.scalar(select(func.count()).select_from(Message)) == 0


def test_edit_cancel_and_revision_conflicts(owner, channel, engine, monkeypatch):
    monkeypatch.setattr(service, "utc_now", lambda: NOW)
    queued = scheduled(owner, channel)
    fields = {key: queued[key] for key in ("content", "send_at", "timezone", "revision")}
    fields["content"] = "Changed before sending"
    response = owner.put(f"{API}/scheduled-messages/{queued['id']}", json=fields)
    assert response.status_code == 200
    assert response.json()["revision"] == 2
    assert owner.put(f"{API}/scheduled-messages/{queued['id']}", json=fields).status_code == 409
    assert owner.delete(f"{API}/scheduled-messages/{queued['id']}?revision=1").status_code == 409
    assert owner.delete(f"{API}/scheduled-messages/{queued['id']}?revision=2").status_code == 204
    advance_due(engine, NOW + timedelta(seconds=10), NOW)
    assert owner.get(f"{API}/channels/{channel['id']}/messages").json()["items"] == []


def test_restart_skips_a_large_backlog_across_batches(owner, channel, engine, db):
    from app.auth.models import LoginSession

    user_id = db.scalar(select(LoginSession.user_id))
    for index in range(105):
        db.add(
            ScheduledMessage(
                owner_id=user_id,
                channel_id=UUID(channel["id"]),
                content=f"Missed {index}",
                send_at=NOW - timedelta(minutes=10),
                timezone="UTC",
            )
        )
    db.add(
        ScheduledMessage(
            owner_id=user_id,
            channel_id=UUID(channel["id"]),
            content="On time after restart",
            send_at=NOW + timedelta(seconds=5),
            timezone="UTC",
        )
    )
    db.commit()
    advance_due(engine, NOW, None)
    advance_due(engine, NOW + timedelta(seconds=5), NOW)
    assert (
        db.scalar(
            select(func.count())
            .select_from(ScheduledMessage)
            .where(ScheduledMessage.status == "skipped")
        )
        == 105
    )
    assert list(db.scalars(select(Message.content))) == ["On time after restart"]


def test_lost_commit_acknowledgement_does_not_publish_twice(
    owner, channel, engine, db, monkeypatch
):
    from sqlalchemy.orm import Session

    from app.publishing import worker

    scheduled(owner, channel)

    class LostAcknowledgement(Session):
        def commit(self):
            super().commit()
            raise RuntimeError("Connection dropped after commit")

    with monkeypatch.context() as patch:
        patch.setattr(worker, "Session", LostAcknowledgement)
        with pytest.raises(RuntimeError, match="after commit"):
            advance_due(engine, NOW + timedelta(seconds=10), NOW)
    advance_due(engine, NOW + timedelta(seconds=15), NOW)
    assert db.scalar(select(func.count()).select_from(Message)) == 1


def test_schedule_validation_and_channel_changes(owner, channel, monkeypatch):
    monkeypatch.setattr(service, "utc_now", lambda: NOW)
    path = f"{API}/channels/{channel['id']}/scheduled-messages"
    data = {"content": "hello", "timezone": "UTC", "send_at": NOW.isoformat()}
    assert owner.post(path, json=data).status_code == 422
    data["send_at"] = (NOW + timedelta(hours=1)).isoformat()
    assert owner.post(path, json={**data, "content": "  "}).status_code == 422
    assert owner.post(path, json={**data, "timezone": "Missing/Zone"}).status_code == 422
    assert owner.post(path, json={**data, "send_at": "2026-10-19T12:00:00"}).status_code == 422
    queued = scheduled(owner, channel)
    changed = owner.put(
        f"{API}/channels/{channel['id']}", json={"name": channel["name"], "kind": "reminder"}
    )
    assert changed.status_code == 422
    owner.delete(f"{API}/scheduled-messages/{queued['id']}?revision=1")
    assert (
        owner.put(
            f"{API}/channels/{channel['id']}", json={"name": channel["name"], "kind": "reminder"}
        ).status_code
        == 200
    )
    assert owner.post(path, json=data).status_code == 422
    assert owner.get(f"{API}/channels/{uuid4()}/scheduled-messages").status_code == 404
    assert owner.delete(f"{API}/scheduled-messages/{uuid4()}?revision=1").status_code == 404


def test_posting_completes_prompt_and_home_read_is_separate(owner, channel, engine, monkeypatch):
    from app.home import service as home_service
    from app.notes.services import messages

    monkeypatch.setattr(service, "utc_now", lambda: NOW)
    rule = writing(owner, channel)
    fired = NOW + timedelta(seconds=10)
    advance_due(engine, fired, NOW)
    monkeypatch.setattr(home_service, "utc_now", lambda: fired)
    monkeypatch.setattr(messages, "utc_now", lambda: fired)
    items = owner.get(f"{API}/home/activity").json()["items"]
    item = next(item for item in items if item["kind"] == "writing")
    assert item["id"] == rule["id"]
    assert item["channel_id"] == channel["id"]
    assert not item["read"]
    assert (
        owner.post(
            f"{API}/home/activity/read",
            json={"items": [{key: item[key] for key in ("kind", "id", "revision")}]},
        ).status_code
        == 204
    )
    current = owner.get(f"{API}/channels/{channel['id']}/writing-prompt").json()
    assert current["due_at"] is not None
    assert (
        owner.post(
            f"{API}/channels/{channel['id']}/messages", json={"content": "My day was good"}
        ).status_code
        == 201
    )
    assert owner.get(f"{API}/channels/{channel['id']}/writing-prompt").json()["due_at"] is None
    assert not owner.get(f"{API}/home/activity").json()["items"]
    advance_due(engine, fired + timedelta(days=1), fired + timedelta(days=1, seconds=-5))
    assert owner.get(f"{API}/channels/{channel['id']}/writing-prompt").json()["due_at"] is not None


def test_disable_dismiss_and_stale_writing_updates(owner, channel, engine, monkeypatch):
    monkeypatch.setattr(service, "utc_now", lambda: NOW)
    original = writing(owner, channel)
    advance_due(engine, NOW + timedelta(seconds=10), NOW)
    assert (
        owner.post(f"{API}/channels/{channel['id']}/writing-prompt/dismiss?revision=1").status_code
        == 409
    )
    assert (
        owner.post(f"{API}/channels/{channel['id']}/writing-prompt/dismiss?revision=2").status_code
        == 204
    )
    path = f"{API}/channels/{channel['id']}/writing-prompt"
    fields = {
        key: original[key]
        for key in (
            "content",
            "start_at",
            "timezone",
            "frequency",
            "weekdays",
            "enabled",
            "revision",
        )
    }
    assert owner.put(path, json=fields).status_code == 409
    fields.update(revision=2, enabled=False)
    assert owner.put(path, json=fields).status_code == 200
    advance_due(engine, NOW + timedelta(days=1, seconds=10), NOW + timedelta(days=1, seconds=5))
    assert owner.get(path).json()["due_at"] is None


def test_recurrence_custom_days_biweeks_month_end_and_dst():
    def rule(start, frequency, weekdays=None, timezone="UTC"):
        return WritingFields(
            content="Write",
            start_at=start,
            timezone=timezone,
            frequency=frequency,
            weekdays=weekdays or [],
        )

    monday = datetime(2026, 10, 19, 9, tzinfo=UTC)
    weekly = rule(monday, "weekly", [0, 4])
    assert next_occurrence(weekly, monday) == monday + timedelta(days=4)
    biweekly = rule(monday, "biweekly", [0, 4])
    assert next_occurrence(biweekly, monday + timedelta(days=4)) == monday + timedelta(days=14)
    month = datetime(2026, 1, 31, 9, tzinfo=UTC)
    assert next_occurrence(rule(month, "monthly"), month) == datetime(2026, 3, 31, 9, tzinfo=UTC)
    spring = rule(datetime(2026, 3, 7, 7, 30, tzinfo=UTC), "daily", timezone="America/New_York")
    assert next_occurrence(spring, spring.start_at) == datetime(2026, 3, 9, 6, 30, tzinfo=UTC)
    fall = rule(datetime(2026, 10, 31, 5, 30, tzinfo=UTC), "daily", timezone="America/New_York")
    first = next_occurrence(fall, fall.start_at)
    assert first == datetime(2026, 11, 1, 5, 30, tzinfo=UTC)
    assert next_occurrence(fall, first) == datetime(2026, 11, 2, 6, 30, tzinfo=UTC)


def test_portable_backup_includes_schedules_without_credentials(owner, channel, monkeypatch):
    monkeypatch.setattr(service, "utc_now", lambda: NOW)
    scheduled(owner, channel)
    writing(owner, channel, frequency="weekly", weekdays=[0, 4])
    ready, raw = export(owner)
    assert ready["counts"]["scheduled_messages"] == 1
    assert ready["counts"]["writing_prompts"] == 1
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        metadata = json.loads(archive.read("content.json"))
    assert metadata["version"] == 6
    assert "owner_id" not in metadata["scheduled_messages"][0]
    assert "read_revision" not in metadata["writing_prompts"][0]
    preview = upload(owner, raw)
    assert preview.status_code == 200, preview.text
    response = owner.post(
        f"{API}/backups/import", json={"token": preview.json()["token"], "mode": "merge"}
    )
    assert response.status_code == 200, response.text
    workspaces = owner.get(f"{API}/workspaces").json()
    assert len(workspaces) == 2
    imported = next(item for item in workspaces if item["id"] != channel["workspace_id"])
    new_channel = owner.get(f"{API}/workspaces/{imported['id']}/channels").json()[0]
    assert (
        owner.get(f"{API}/channels/{new_channel['id']}/scheduled-messages").json()[0]["status"]
        == "pending"
    )
    rule = owner.get(f"{API}/channels/{new_channel['id']}/writing-prompt").json()
    assert rule["weekdays"] == [0, 4]
    assert rule["due_at"] is None
