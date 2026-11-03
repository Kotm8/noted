import json
from datetime import timedelta
from unittest.mock import Mock

from app.notifications import routing
from app.schedule.prompts import delivery
from tests.conftest import API
from tests.test_plan_end_prompts import clock, ending  # noqa: F401
from tests.test_plan_prompts import NOW, act, activity, due, planned
from tests.test_reminders import subscribe


def together(owner, clock):  # noqa: F811
    reading, work = activity(owner, "Reading"), activity(owner, "Work")
    planned(owner, reading["id"], title="A chapter")
    planned(owner, work["id"], title="Budget review")
    clock[0] = NOW
    prompts = due(owner)
    assert len(prompts) == 2
    return reading, work, prompts


def dispatch(db, monkeypatch):
    send = Mock(return_value="accepted")
    monkeypatch.setattr(routing, "send_push", send)
    delivery.dispatch_plan_prompts(db.get_bind(), "https://notes.example.com", None)
    return send


def test_plans_starting_together_share_one_notification(owner, clock, db, monkeypatch):  # noqa: F811
    _reading, work, prompts = together(owner, clock)
    subscribe(owner, "mobile")
    send = dispatch(db, monkeypatch)
    assert send.call_count == 1
    payload = json.loads(send.call_args.args[3])
    assert payload["title"] == "Time for Reading or Work"
    assert payload["body"] == "A chapter · Budget review"
    assert [item["activityName"] for item in payload["alternatives"]] == ["Work"]
    assert dispatch(db, monkeypatch).call_count == 0

    second = next(item for item in prompts if item["activity_id"] == work["id"])
    assert act(owner, second, "start").status_code == 200
    assert due(owner) == []
    assert owner.get(f"{API}/time-tracking/tracker").json()["active"]["activity_id"] == work["id"]


def test_delaying_one_of_plans_starting_together_delays_both(owner, clock):  # noqa: F811
    _reading, _work, prompts = together(owner, clock)
    response = act(owner, prompts[0], "delay", minutes=5, reason="Something came up")
    assert response.status_code == 200, response.text
    assert due(owner) == []
    clock[0] += timedelta(minutes=5)
    again = due(owner)
    assert len(again) == 2
    assert len({item["notify_at"] for item in again}) == 1


def test_end_prompt_offers_the_overlapping_plan_still_running(owner, clock, db, monkeypatch):  # noqa: F811
    work = activity(owner, "Work")
    planned(owner, work["id"], title="Write report", start_minute=690, end_minute=780)
    ending(owner, clock)
    prompt = next(item for item in due(owner) if item["phase"] == "end")
    assert prompt["switch_activity_id"] == work["id"]
    assert prompt["switch_title"] == "Write report"
    subscribe(owner, "mobile")
    payload = json.loads(dispatch(db, monkeypatch).call_args.args[3])
    assert payload["switchActivityName"] == "Work"
    assert "Switch to Work" in payload["body"]

    response = act(owner, prompt, "switch")
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "switched"
    assert owner.get(f"{API}/time-tracking/tracker").json()["active"]["activity_id"] == work["id"]
    assert due(owner) == []


def test_switch_is_refused_without_an_overlapping_plan(owner, clock):  # noqa: F811
    ending(owner, clock)
    prompt = due(owner)[0]
    assert prompt["switch_activity_id"] is None
    assert act(owner, prompt, "switch").status_code == 409


def test_same_activity_overlap_keeps_the_plain_end_prompt(owner, clock):  # noqa: F811
    item, _plan, _session = ending(owner, clock)
    planned(owner, item["id"], title="More reading", start_minute=690, end_minute=780)
    ends = [prompt for prompt in due(owner) if prompt["phase"] == "end"]
    assert [prompt["switch_activity_id"] for prompt in ends] == [None]
