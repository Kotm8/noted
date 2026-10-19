from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from sqlalchemy import select

from app.schedule.prompts import service
from app.schedule.prompts.models import PlanPrompt, PlanPromptEvent
from tests.conftest import API
from tests.test_backups import export, upload

NOW = datetime(2026, 10, 19, 12, tzinfo=UTC)


def activity(owner, name):
    return owner.post(f"{API}/time-tracking/activities", json={"name": name}).json()


def planned(owner, activity_id, **values):
    response = owner.post(
        f"{API}/schedule/plans",
        json={
            "activity_id": activity_id,
            "title": "Read a chapter",
            "date": NOW.date().isoformat(),
            "start_minute": 725,
            "end_minute": 780,
            "timezone": "UTC",
            "notification_minutes": 10,
            **values,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def due(owner):
    response = owner.get(f"{API}/schedule/prompts")
    assert response.status_code == 200, response.text
    return response.json()


def act(owner, prompt, action, **values):
    return owner.post(
        f"{API}/schedule/prompts/{prompt['id']}/actions",
        json={
            "action": action,
            "revision": prompt["revision"],
            "request_id": str(uuid4()),
            **values,
        },
    )


def test_delay_requires_a_reason_keeps_the_plan_fixed_and_counts_from_press(owner, monkeypatch, db):
    monkeypatch.setattr(service, "utc_now", lambda: NOW)
    item = activity(owner, "Reading")
    plan = planned(owner, item["id"])
    prompt = due(owner)[0]
    assert act(owner, prompt, "delay", minutes=5).status_code == 422
    assert act(owner, prompt, "delay", minutes=5, reason="   ").status_code == 422
    response = act(owner, prompt, "delay", minutes=5, reason="Finishing current activity")
    assert response.status_code == 200, response.text
    assert datetime.fromisoformat(response.json()["notify_at"]) == NOW + timedelta(minutes=5)
    assert due(owner) == []
    unchanged = owner.get(f"{API}/schedule/plans/{plan['id']}").json()
    assert unchanged["start_minute"] == plan["start_minute"]
    assert unchanged["date"] == plan["date"]
    assert owner.get(f"{API}/time-tracking/tracker").json()["active"] is None
    monkeypatch.setattr(service, "utc_now", lambda: NOW + timedelta(minutes=5))
    assert due(owner)[0]["revision"] == response.json()["revision"]
    assert db.scalar(select(PlanPromptEvent.reason)) == "Finishing current activity"


def test_start_switches_the_global_timer_atomically_and_retries_do_not_restart_it(
    owner, monkeypatch
):
    monkeypatch.setattr(service, "utc_now", lambda: NOW)
    first, second = activity(owner, "Work"), activity(owner, "Reading")
    state = owner.get(f"{API}/time-tracking/tracker").json()
    owner.post(
        f"{API}/time-tracking/tracker",
        json={
            "action": "start",
            "activity_id": first["id"],
            "revision": state["revision"],
            "request_id": str(uuid4()),
        },
    )
    planned(owner, second["id"])
    prompt = due(owner)[0]
    body = {"action": "start", "revision": prompt["revision"], "request_id": str(uuid4())}
    assert (
        owner.post(f"{API}/schedule/prompts/{prompt['id']}/actions", json=body).status_code == 200
    )
    active = owner.get(f"{API}/time-tracking/tracker").json()["active"]
    assert active["activity_id"] == second["id"]
    assert (
        owner.post(f"{API}/schedule/prompts/{prompt['id']}/actions", json=body).status_code == 200
    )
    assert owner.get(f"{API}/time-tracking/tracker").json()["active"]["id"] == active["id"]
    assert due(owner) == []
    assert act(owner, prompt, "delay", minutes=10, reason="Taking a break").status_code == 409


def test_other_activity_starts_immediately_and_snoozes_original(owner, monkeypatch):
    monkeypatch.setattr(service, "utc_now", lambda: NOW)
    first, second = activity(owner, "Reading"), activity(owner, "Coding")
    plan = planned(owner, first["id"])
    prompt = due(owner)[0]
    response = act(
        owner, prompt, "other", activity_id=second["id"], minutes=30, reason="Something came up"
    )
    assert response.status_code == 200, response.text
    assert owner.get(f"{API}/time-tracking/tracker").json()["active"]["activity_id"] == second["id"]
    assert owner.get(f"{API}/schedule/plans/{plan['id']}").json()["activity_id"] == first["id"]
    history = owner.get(f"{API}/schedule/plans/{plan['id']}/prompt-history").json()
    assert history[0]["minutes"] == 30 and history[0]["reason"] == "Something came up"


def test_default_notice_override_opt_out_and_deleted_plans(owner, monkeypatch):
    monkeypatch.setattr(service, "utc_now", lambda: NOW)
    item = activity(owner, "Reading")
    plan = planned(owner, item["id"], notification_minutes=None)
    assert due(owner) == []
    owner.put(f"{API}/notifications/settings", json={"plan_notice_minutes": 5})
    assert len(due(owner)) == 1
    response = owner.put(
        f"{API}/schedule/plans/{plan['id']}", json={**plan, "notifications_enabled": False}
    )
    assert response.status_code == 200
    assert due(owner) == []
    updated = response.json()
    assert (
        owner.delete(
            f"{API}/schedule/plans/{plan['id']}?revision={updated['revision']}"
        ).status_code
        == 200
    )
    assert due(owner) == []


def test_recurring_plan_has_one_prompt_per_occurrence_and_supersedes_missed_days(
    owner, monkeypatch, db
):
    monkeypatch.setattr(service, "utc_now", lambda: NOW)
    item = activity(owner, "Reading")
    planned(owner, item["id"], frequency="weekly", weekdays=[0, 4])
    first = due(owner)[0]
    assert due(owner)[0]["id"] == first["id"]
    monkeypatch.setattr(service, "utc_now", lambda: NOW + timedelta(days=4))
    second = due(owner)[0]
    assert second["id"] != first["id"]
    db.expire_all()
    assert db.get(PlanPrompt, UUID(first["id"])).status == "superseded"


def test_backup_restores_notification_choices_and_delay_history(owner, monkeypatch):
    monkeypatch.setattr(service, "utc_now", lambda: NOW)
    item = activity(owner, "Reading")
    planned(owner, item["id"])
    prompt = due(owner)[0]
    response = act(owner, prompt, "delay", minutes=15, reason="Finishing my work")
    assert response.status_code == 200, response.text
    _, raw = export(owner)
    preview = upload(owner, raw)
    assert preview.status_code == 200, preview.text
    restored = owner.post(
        f"{API}/backups/import",
        json={
            "token": preview.json()["token"],
            "mode": "replace",
            "confirmation": "REPLACE MY NOTES",
        },
    )
    assert restored.status_code == 200, restored.text
    board = owner.get(
        f"{API}/schedule",
        params={"start": NOW.isoformat(), "end": (NOW + timedelta(days=1)).isoformat()},
    ).json()
    plan = board["plans"][0]
    assert plan["notification_minutes"] == 10
    history = owner.get(f"{API}/schedule/plans/{plan['id']}/prompt-history").json()
    assert history[0]["reason"] == "Finishing my work"
    assert history[0]["minutes"] == 15
