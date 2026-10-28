import json
from datetime import datetime, timedelta
from unittest.mock import Mock
from uuid import uuid4

import pytest

from app.notifications import routing
from app.schedule.prompts import delivery, service
from app.time_tracking import service as tracking_service
from tests.conftest import API
from tests.test_backups import export, upload
from tests.test_plan_prompts import NOW, act, activity, due, planned
from tests.test_reminders import subscribe


@pytest.fixture
def clock(monkeypatch):
    current = [NOW - timedelta(minutes=30)]
    for module in (service, tracking_service, delivery):
        monkeypatch.setattr(module, "utc_now", lambda: current[0])
    return current


def track(owner, activity_id):
    state = owner.get(f"{API}/time-tracking/tracker").json()
    response = owner.post(
        f"{API}/time-tracking/tracker",
        json={
            "action": "start",
            "activity_id": activity_id,
            "revision": state["revision"],
            "request_id": str(uuid4()),
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["active"]


def ending(owner, clock, **values):
    item = activity(owner, "Reading")
    plan = planned(owner, item["id"], start_minute=660, end_minute=720, **values)
    session = track(owner, item["id"])
    clock[0] = NOW
    return item, plan, session


def test_end_prompt_stops_tracking_once_and_preserves_backup_history(owner, clock):
    _item, plan, session = ending(owner, clock)
    prompt = due(owner)[0]
    assert prompt["phase"] == "end"
    assert datetime.fromisoformat(prompt["planned_end"]) == NOW
    assert owner.get(f"{API}/time-tracking/tracker").json()["active"]["id"] == session["id"]
    body = {"action": "stop", "revision": prompt["revision"], "request_id": str(uuid4())}
    path = f"{API}/schedule/prompts/{prompt['id']}/actions"
    assert owner.post(path, json=body).status_code == 200
    assert owner.post(path, json=body).status_code == 200
    assert owner.get(f"{API}/time-tracking/tracker").json()["active"] is None
    assert due(owner) == []
    history = owner.get(f"{API}/schedule/plans/{plan['id']}/prompt-history").json()
    assert [item["action"] for item in history] == ["stop"]
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
    assert owner.get(f"{API}/time-tracking/tracker").json()["active"] is None


def test_end_snooze_keeps_tracking_and_does_not_move_plan(owner, clock):
    _item, plan, session = ending(owner, clock)
    prompt = due(owner)[0]
    assert act(owner, prompt, "start").status_code == 409
    response = act(owner, prompt, "delay", minutes=5, reason="Finishing up current task")
    assert response.status_code == 200, response.text
    assert due(owner) == []
    assert owner.get(f"{API}/time-tracking/tracker").json()["active"]["id"] == session["id"]
    assert owner.get(f"{API}/schedule/plans/{plan['id']}").json()["end_minute"] == 720
    clock[0] += timedelta(minutes=5)
    repeated = due(owner)[0]
    assert repeated["phase"] == "end" and repeated["revision"] == response.json()["revision"]
    assert repeated["planned_end"] == prompt["planned_end"]


@pytest.mark.parametrize("gap,expected", [(0, False), (15, False), (16, True), (60, True)])
def test_next_plan_within_fifteen_minutes_suppresses_end_even_when_its_alerts_are_off(
    owner, clock, gap, expected
):
    ending(owner, clock)
    next_activity = activity(owner, "Work")
    planned(
        owner,
        next_activity["id"],
        start_minute=720 + gap,
        end_minute=840,
        notifications_enabled=False,
    )
    assert bool([item for item in due(owner) if item["phase"] == "end"]) is expected


def test_end_prompt_cannot_stop_an_activity_switched_on_another_device(owner, clock):
    item, _plan, _session = ending(owner, clock)
    prompt = due(owner)[0]
    other = activity(owner, "Work")
    track(owner, other["id"])
    clock[0] += timedelta(seconds=1)
    track(owner, item["id"])
    assert act(owner, prompt, "stop").status_code == 409
    assert owner.get(f"{API}/time-tracking/tracker").json()["active"] is not None
    assert due(owner) == []


def test_plan_extension_moves_end_prompt_to_new_end(owner, clock):
    _item, plan, _session = ending(owner, clock)
    prompt = due(owner)[0]
    updated = owner.put(f"{API}/schedule/plans/{plan['id']}", json={**plan, "end_minute": 780})
    assert updated.status_code == 200
    assert due(owner) == []
    clock[0] += timedelta(hours=1)
    latest = due(owner)[0]
    assert latest["phase"] == "end" and latest["revision"] > prompt["revision"]


def test_end_delivery_is_once_per_revision_and_uses_existing_focus_rules(
    owner, clock, db, monkeypatch
):
    ending(owner, clock)
    desktop, _phone = subscribe(owner), subscribe(owner, "mobile")
    owner.post(
        f"{API}/notifications/presence",
        json={
            "device_id": desktop["device_id"],
            "kind": "desktop",
            "focused": True,
        },
    )
    send = Mock(return_value="accepted")
    monkeypatch.setattr(routing, "send_push", send)
    delivery.dispatch_plan_prompts(db.get_bind(), "https://notes.example.com", None)
    delivery.dispatch_plan_prompts(db.get_bind(), "https://notes.example.com", None)
    assert send.call_count == 1
    payload = json.loads(send.call_args.args[3])
    assert payload["phase"] == "end"
    assert payload["title"] == "Reading has ended"
    assert "prompt=" in payload["url"]
