import io
import json
import zipfile
from datetime import timedelta
from unittest.mock import Mock
from uuid import uuid4

import pytest
from sqlalchemy import func, select

from app.core.security import utc_now
from app.notifications import routing
from app.notifications.worker import dispatch_dismissals
from app.time_tracking import service as tracking
from app.writing_nudges.models import WritingNudgeRun
from app.writing_nudges.worker import advance_nudges, dispatch_nudges
from tests.conftest import API
from tests.test_backups import export, upload
from tests.test_reminders import subscribe


@pytest.fixture
def clock(monkeypatch):
    from app.home import service as home
    from app.notes.services import messages
    from app.schedule.prompts import service as prompts

    clock = [utc_now() + timedelta(days=2)]
    for module in (tracking, home, messages, routing, prompts):
        monkeypatch.setattr(module, "utc_now", lambda: clock[0])
    return clock


def activity(owner, channel, **config):
    response = owner.post(
        f"{API}/time-tracking/activities",
        json={
            "name": "Building",
            "writing_nudge": {
                "enabled": True,
                "interval_minutes": 10,
                "channel_id": channel["id"],
                "content": "What did you finish?",
                "on_stop": False,
                **config,
            },
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def act(owner, action, **values):
    state = owner.get(f"{API}/time-tracking/tracker").json()
    response = owner.post(
        f"{API}/time-tracking/tracker",
        json={
            "action": action,
            "revision": state["revision"],
            "request_id": str(uuid4()),
            **values,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def pending(owner, channel):
    return owner.get(
        f"{API}/time-tracking/writing-nudges", params={"channel_id": channel["id"]}
    ).json()


def test_pause_preserves_tracked_time_and_survives_new_sessions(owner, channel, engine, clock):
    item = activity(owner, channel)
    act(owner, "start", activity_id=item["id"])
    clock[0] += timedelta(minutes=4)
    act(owner, "pause")
    clock[0] += timedelta(hours=2)
    advance_nudges(engine, clock[0])
    assert pending(owner, channel) == []
    act(owner, "resume")
    clock[0] += timedelta(minutes=5, seconds=59)
    advance_nudges(engine, clock[0])
    assert pending(owner, channel) == []
    clock[0] += timedelta(seconds=1)
    advance_nudges(engine, clock[0])
    assert len(pending(owner, channel)) == 1
    advance_nudges(engine, clock[0])
    assert len(pending(owner, channel)) == 1


def test_writing_restarts_before_due_and_clears_a_due_nudge(owner, channel, engine, clock):
    item = activity(owner, channel)
    act(owner, "start", activity_id=item["id"])
    clock[0] += timedelta(minutes=8)
    assert (
        owner.post(
            f"{API}/channels/{channel['id']}/messages", json={"content": "Progress"}
        ).status_code
        == 201
    )
    clock[0] += timedelta(minutes=9)
    advance_nudges(engine, clock[0])
    assert pending(owner, channel) == []
    clock[0] += timedelta(minutes=1)
    advance_nudges(engine, clock[0])
    notice = pending(owner, channel)[0]
    home = owner.get(f"{API}/home/activity").json()["items"]
    assert any(item["kind"] == "nudge" and item["id"] == notice["id"] for item in home)
    assert (
        owner.post(
            f"{API}/home/activity/read",
            json={"items": [{"kind": "nudge", "id": notice["id"], "revision": notice["revision"]}]},
        ).status_code
        == 204
    )
    owner.post(f"{API}/channels/{channel['id']}/messages", json={"content": "Done"})
    assert pending(owner, channel) == []
    clock[0] += timedelta(minutes=10)
    advance_nudges(engine, clock[0])
    assert pending(owner, channel)[0]["revision"] > notice["revision"]


def test_writing_while_paused_resets_without_counting_the_pause(owner, channel, engine, clock):
    item = activity(owner, channel)
    act(owner, "start", activity_id=item["id"])
    clock[0] += timedelta(minutes=8)
    act(owner, "pause")
    owner.post(f"{API}/channels/{channel['id']}/messages", json={"content": "Break update"})
    clock[0] += timedelta(days=1)
    act(owner, "resume")
    clock[0] += timedelta(minutes=9)
    advance_nudges(engine, clock[0])
    assert pending(owner, channel) == []
    clock[0] += timedelta(minutes=1)
    advance_nudges(engine, clock[0])
    assert len(pending(owner, channel)) == 1


@pytest.mark.parametrize("on_stop", [False, True])
def test_final_nudge_and_retry_are_optional_and_idempotent(owner, channel, clock, on_stop):
    item = activity(owner, channel, on_stop=on_stop)
    act(owner, "start", activity_id=item["id"])
    clock[0] += timedelta(minutes=2)
    state = owner.get(f"{API}/time-tracking/tracker").json()
    command = {"action": "stop", "revision": state["revision"], "request_id": str(uuid4())}
    assert owner.post(f"{API}/time-tracking/tracker", json=command).status_code == 200
    assert owner.post(f"{API}/time-tracking/tracker", json=command).status_code == 200
    assert len(pending(owner, channel)) == int(on_stop)


def test_restart_generates_one_current_nudge_without_catchup_flood(owner, channel, engine, clock):
    item = activity(owner, channel)
    act(owner, "start", activity_id=item["id"])
    clock[0] += timedelta(days=2)
    advance_nudges(engine, clock[0])
    assert len(pending(owner, channel)) == 1
    advance_nudges(engine, clock[0])
    assert pending(owner, channel)[0]["revision"] == 1


def test_stopping_at_an_interval_does_not_lose_or_repeat_it(owner, channel, engine, clock):
    item = activity(owner, channel, on_stop=True)
    act(owner, "start", activity_id=item["id"])
    clock[0] += timedelta(minutes=10)
    advance_nudges(engine, clock[0])
    act(owner, "stop")
    assert pending(owner, channel)[0]["revision"] == 1


def test_stopping_before_the_worker_runs_keeps_the_due_interval(owner, channel, clock):
    item = activity(owner, channel, on_stop=False)
    act(owner, "start", activity_id=item["id"])
    clock[0] += timedelta(minutes=10)
    act(owner, "stop")
    assert len(pending(owner, channel)) == 1


def test_deleted_target_does_not_break_tracking_or_backups(owner, channel, clock):
    clock[0] = utc_now() - timedelta(minutes=1)
    item = activity(owner, channel)
    assert owner.delete(f"{API}/channels/{channel['id']}").status_code == 204
    act(owner, "start", activity_id=item["id"])
    clock[0] += timedelta(seconds=10)
    act(owner, "stop")
    _, raw = export(owner)
    assert upload(owner, raw).status_code == 200


def test_plan_override_reconfigures_the_same_activity_without_restarting_timer(
    owner, channel, clock, db
):
    item = activity(owner, channel)
    original = act(owner, "start", activity_id=item["id"])
    plan = owner.post(
        f"{API}/schedule/plans",
        json={
            "activity_id": item["id"],
            "title": "Build",
            "date": clock[0].date().isoformat(),
            "start_minute": 0,
            "end_minute": 1440,
            "timezone": "UTC",
            "writing_nudge": {
                "enabled": True,
                "interval_minutes": 2,
                "channel_id": channel["id"],
            },
        },
    ).json()
    current = act(owner, "start", activity_id=item["id"], plan_id=plan["id"])
    assert current["active"]["id"] == original["active"]["id"]
    assert current["revision"] == original["revision"] + 1
    assert db.scalar(select(WritingNudgeRun)).remaining_seconds == 120


@pytest.mark.parametrize(
    "override", [None, {"enabled": False}, {"enabled": True, "interval_minutes": 2}]
)
def test_plan_override_is_used_when_starting_a_plan(owner, channel, clock, db, override):
    item = activity(owner, channel)
    if override and override["enabled"]:
        override = {**override, "channel_id": channel["id"]}
    plan = owner.post(
        f"{API}/schedule/plans",
        json={
            "activity_id": item["id"],
            "title": "Build",
            "date": clock[0].date().isoformat(),
            "start_minute": 0,
            "end_minute": 1440,
            "timezone": "UTC",
            "writing_nudge": override,
        },
    )
    assert plan.status_code == 201, plan.text
    act(
        owner,
        "start",
        activity_id=item["id"],
        plan_id=plan.json()["id"],
        occurrence_date=clock[0].date().isoformat(),
    )
    run = db.scalar(select(WritingNudgeRun))
    if override is not None and not override["enabled"]:
        assert run is None
    else:
        assert run.remaining_seconds == (120 if override else 600)


@pytest.mark.parametrize(
    "config",
    [
        {"interval_minutes": 0},
        {"interval_minutes": 1441},
        {"channel_id": None},
        {"channel_id": str(uuid4())},
        {"content": "  "},
    ],
)
def test_invalid_settings_are_rejected(owner, channel, config):
    response = owner.post(
        f"{API}/time-tracking/activities",
        json={
            "name": "Bad",
            "writing_nudge": {"enabled": True, "channel_id": channel["id"], **config},
        },
    )
    assert response.status_code == 422, response.text


def test_delivery_respects_quiet_hours_and_does_not_repeat(
    owner, channel, engine, app, clock, monkeypatch
):
    from tests.test_quiet_hours import quiet

    item = activity(owner, channel)
    act(owner, "start", activity_id=item["id"])
    subscribe(owner, "mobile")
    clock[0] += timedelta(minutes=10)
    minute = clock[0].hour * 60 + clock[0].minute
    assert quiet(owner, (minute - 30) % 1440, (minute + 30) % 1440).status_code == 200
    send = Mock(return_value="accepted")
    monkeypatch.setattr(routing, "send_push", send)
    advance_nudges(engine, clock[0])
    dispatch_nudges(engine, app.state.settings)
    assert send.call_count == 0
    settings = owner.get(f"{API}/notifications/settings").json()
    owner.put(f"{API}/notifications/settings", json={**settings, "quiet_hours": False})
    dispatch_nudges(engine, app.state.settings)
    dispatch_nudges(engine, app.state.settings)
    assert send.call_count == 1
    payload = json.loads(send.call_args.args[3])
    assert payload["kind"] == "writing" and payload["url"].endswith(f"/c/{channel['id']}?write=1")
    assert payload["title"].endswith(f"/ #{channel['name']}")


def test_dismiss_checks_revision_and_writing_dismisses_native_notification(
    owner, channel, engine, app, clock, monkeypatch, db
):
    from app.notifications.models import PushSubscription

    item = activity(owner, channel)
    act(owner, "start", activity_id=item["id"])
    subscribe(owner, "mobile")
    subscription = db.scalar(select(PushSubscription))
    subscription.endpoint = f"fcm:{uuid4()}"
    db.commit()
    send = Mock(return_value="accepted")
    monkeypatch.setattr(routing, "send_push", send)
    clock[0] += timedelta(minutes=10)
    advance_nudges(engine, clock[0])
    dispatch_nudges(engine, app.state.settings)
    notice = pending(owner, channel)[0]
    assert (
        owner.post(
            f"{API}/time-tracking/writing-nudges/{notice['id']}/dismiss", json={"revision": 999}
        ).status_code
        == 409
    )
    owner.post(f"{API}/channels/{channel['id']}/messages", json={"content": "Update"})
    dispatch_dismissals(engine, app.state.settings.app_origin, app.state.settings)
    assert any(json.loads(call.args[3]).get("target") == "writing" for call in send.call_args_list)


def test_backup_remaps_channel_targets_and_does_not_restart_timer(owner, channel, clock, db):
    clock[0] = utc_now() - timedelta(minutes=1)
    item = activity(owner, channel)
    act(owner, "start", activity_id=item["id"])
    _, raw = export(owner)
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        document = json.loads(archive.read("content.json"))
    assert document["version"] == 8
    assert document["activities"][0]["writing_nudge"]["channel_id"] == channel["id"]
    preview = upload(owner, raw)
    assert preview.status_code == 200, preview.text
    response = owner.post(
        f"{API}/backups/import",
        json={
            "token": preview.json()["token"],
            "mode": "replace",
            "confirmation": "REPLACE MY NOTES",
        },
    )
    assert response.status_code == 200, response.text
    imported = owner.get(f"{API}/time-tracking/activities").json()[0]
    assert imported["writing_nudge"]["channel_id"] != channel["id"]
    assert owner.get(f"{API}/time-tracking/tracker").json()["active"] is None
    db.expire_all()
    assert db.scalar(select(func.count()).select_from(WritingNudgeRun)) == 0
