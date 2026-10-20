from datetime import timedelta
from uuid import uuid4

from fastapi.testclient import TestClient

from app.core.security import utc_now
from tests.conftest import API
from tests.test_time_schedule import activity


def pair(owner: TestClient) -> dict:
    response = owner.post(f"{API}/wear/pairings")
    assert response.status_code == 201, response.text
    ticket = response.json()["ticket"]
    connected = owner.post(f"{API}/wear/connect", json={"ticket": ticket, "name": "Galaxy Watch"})
    assert connected.status_code == 200, connected.text
    assert owner.post(f"{API}/wear/connect", json={"ticket": ticket}).status_code == 401
    return connected.json()


def test_pairing_requires_csrf_and_watch_tokens_are_scoped(owner: TestClient) -> None:
    csrf = owner.headers.pop("X-CSRF-Token")
    assert owner.post(f"{API}/wear/pairings").status_code == 403
    owner.headers["X-CSRF-Token"] = csrf
    credentials = pair(owner)
    assert credentials["origin"] == "http://localhost:5173"
    owner.cookies.clear()
    owner.headers.pop("X-CSRF-Token")
    owner.headers["Authorization"] = f"Bearer {credentials['secret']}"
    assert owner.get(f"{API}/wear/snapshot").status_code == 200
    assert owner.get(f"{API}/time-tracking/tracker").status_code == 401
    assert owner.post(f"{API}/wear/pairings").status_code == 401
    owner.headers["Authorization"] = f"Bearer {'x' * 43}"
    assert owner.get(f"{API}/wear/snapshot").status_code == 401


def test_watch_controls_share_tracker_and_reject_stale_actions(owner: TestClient) -> None:
    task = activity(owner)
    credentials = pair(owner)
    headers = {"Authorization": f"Bearer {credentials['secret']}"}
    initial = owner.get(f"{API}/wear/snapshot", headers=headers).json()
    assert initial["firebase"] is None
    command = {
        "action": "start",
        "activity_id": task["id"],
        "revision": initial["tracker"]["revision"],
        "request_id": str(uuid4()),
    }
    result = owner.post(f"{API}/wear/tracker", headers=headers, json=command)
    assert result.status_code == 200, result.text
    assert (
        owner.get(f"{API}/time-tracking/tracker").json()["active"]["id"]
        == result.json()["active"]["id"]
    )
    assert (
        owner.post(f"{API}/wear/tracker", headers=headers, json=command).json()["active"]["id"]
        == result.json()["active"]["id"]
    )
    assert (
        owner.post(
            f"{API}/wear/tracker", headers=headers, json={**command, "request_id": str(uuid4())}
        ).status_code
        == 409
    )
    sessions = owner.get(f"{API}/auth/sessions").json()
    watch = next(item for item in sessions if "Wear OS" in (item.get("user_agent") or ""))
    assert owner.delete(f"{API}/auth/sessions/{watch['id']}").status_code == 204
    assert owner.get(f"{API}/wear/snapshot", headers=headers).status_code == 401


def test_watch_settings_and_overdue_reminders(owner: TestClient, channel: dict) -> None:
    value = {
        "face": "W24",
        "accent": "#e2c15a",
        "text_scale": 1.15,
        "schedule_hours": 4,
        "hide_contents": True,
        "favorites": [],
    }
    assert owner.put(f"{API}/wear/settings", json=value).json() == value
    assert (
        owner.put(f"{API}/wear/settings", json={**value, "schedule_hours": 99}).status_code == 422
    )
    due = utc_now() + timedelta(seconds=2)
    created = owner.post(
        f"{API}/channels/{channel['id']}/messages",
        json={"content": "Drink water", "reminder": {"due_at": due.isoformat(), "timezone": "UTC"}},
    )
    assert created.status_code == 201, created.text
    message = created.json()
    credentials = pair(owner)
    headers = {"Authorization": f"Bearer {credentials['secret']}"}
    snapshot = owner.get(f"{API}/wear/snapshot", headers=headers)
    assert snapshot.status_code == 200, snapshot.text
    assert snapshot.json()["settings"] == value
    action = owner.post(
        f"{API}/wear/reminders/{message['id']}/actions",
        headers=headers,
        json={"action": "done", "revision": message["reminder"]["revision"]},
    )
    assert action.status_code == 200 and action.json()["status"] == "done"


def test_watch_delay_requires_reason_and_switches_without_moving_plan(owner, monkeypatch) -> None:
    from app.schedule.prompts import service
    from tests.test_plan_prompts import NOW, due, planned

    monkeypatch.setattr(service, "utc_now", lambda: NOW)
    original, other = activity(owner, "Walking"), activity(owner, "Reading")
    plan = planned(owner, original["id"])
    prompt = due(owner)[0]
    credentials = pair(owner)
    headers = {"Authorization": f"Bearer {credentials['secret']}"}
    command = {
        "action": "other",
        "activity_id": other["id"],
        "revision": prompt["revision"],
        "request_id": str(uuid4()),
        "minutes": 15,
    }
    path = f"{API}/wear/prompts/{prompt['id']}/actions"
    assert owner.post(path, headers=headers, json=command).status_code == 422
    response = owner.post(path, headers=headers, json={**command, "reason": "Finishing a chapter"})
    assert response.status_code == 200, response.text
    assert response.json()["notify_at"] == (NOW + timedelta(minutes=15)).isoformat().replace(
        "+00:00", "Z"
    )
    assert owner.get(f"{API}/time-tracking/tracker").json()["active"]["activity_id"] == other["id"]
    unchanged = owner.get(f"{API}/schedule/plans/{plan['id']}").json()
    assert unchanged["start_minute"] == plan["start_minute"]
