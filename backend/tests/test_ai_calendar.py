import json
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from pydantic_ai.models.function import DeltaToolCall, FunctionModel
from sqlalchemy import func, select

from app.ai.calendar.models import CalendarApplicationRecord
from app.ai.calendar.schemas import CalendarRequest
from app.ai.calendar.service import prepare_calendar
from app.ai.runs import RunService
from app.auth.models import User
from app.schedule.models import SchedulePlan
from tests.conftest import API


def setup_calendar(owner):
    activity = owner.post(
        f"{API}/time-tracking/activities",
        json={"name": "Reading", "icon": "BookOpen", "color": "#9db9ce"},
    )
    assert activity.status_code == 201, activity.text
    day = (datetime.now(UTC) + timedelta(days=2)).date().isoformat()
    scope = {
        "start": day,
        "end": day,
        "timezone": "UTC",
        "start_minute": 480,
        "end_minute": 1200,
    }
    block = {
        "activity_id": activity.json()["id"],
        "title": "Read a chapter",
        "date": day,
        "start_minute": 600,
        "end_minute": 660,
        "notifications_enabled": True,
        "notification_minutes": None,
    }
    return scope, block


def apply(owner, scope, blocks, request_id=None):
    return owner.post(
        f"{API}/ai/calendar/applications",
        json={**scope, "blocks": blocks, "request_id": request_id or str(uuid4())},
    )


def test_calendar_context_is_bounded_and_uses_separate_preferences(owner, db):
    scope, block = setup_calendar(owner)
    preferences = owner.get(f"{API}/ai/preferences").json()
    saved = owner.put(
        f"{API}/ai/preferences",
        json={
            **preferences,
            "calendar_note": "No meetings before lunch",
            "standing_note": "Be brief",
        },
    )
    assert saved.status_code == 200
    owner_id = db.scalar(select(User.id))
    prepared = prepare_calendar(
        db, owner_id, CalendarRequest(**scope, instructions="Plan my day", proposals=[block])
    )
    assert prepared.calendar.start.isoformat() == scope["start"]
    assert (
        "Be brief" in prepared.standing_note
        and "No meetings before lunch" in prepared.standing_note
    )
    context = json.loads(prepared.text)
    assert context["activities"][0]["id"] == block["activity_id"]
    assert context["current_proposals"][0]["title"] == block["title"]
    assert not {"sessions", "messages", "entries", "documents"} & context.keys()
    assert not prepared.web_search
    assert (
        owner.post(
            f"{API}/ai/calendar/runs",
            json={**scope, "end": "2099-01-01", "instructions": "Plan"},
        ).status_code
        == 422
    )


def test_generation_returns_structured_proposals_without_saving_plans(owner, db, monkeypatch):
    scope, block = setup_calendar(owner)
    captured = []

    async def answer(messages, info):
        captured.append(messages)
        yield {
            0: DeltaToolCall(
                name=info.output_tools[0].name,
                json_args=json.dumps(
                    {"explanation": "A quiet hour for reading.", "blocks": [block]}
                ),
            )
        }

    monkeypatch.setattr(RunService, "model", lambda *_: FunctionModel(stream_function=answer))
    response = owner.post(
        f"{API}/ai/calendar/runs", json={**scope, "instructions": "Find time to read"}
    )
    assert response.status_code == 200, response.text
    events = [json.loads(line) for line in response.text.splitlines()]
    assert events[0]["type"] == "start"
    assert events[-1]["type"] == "done", events
    assert events[-1]["output"]["blocks"][0]["activity_id"] == block["activity_id"]
    assert "Find time to read" in str(captured)
    assert db.scalar(select(func.count()).select_from(SchedulePlan)) == 0
    run = owner.get(f"{API}/ai/runs").json()[0]
    assert run["place"] == "calendar" and run["outcome"] == "ready"


def test_apply_is_atomic_idempotent_and_tracker_does_not_change(owner, db):
    scope, block = setup_calendar(owner)
    tracker = owner.get(f"{API}/time-tracking/tracker").json()
    request_id = str(uuid4())
    result = apply(owner, scope, [block], request_id)
    assert result.status_code == 200, result.text
    retry = apply(owner, scope, [block], request_id)
    assert retry.json() == result.json()
    assert db.scalar(select(func.count()).select_from(SchedulePlan)) == 1
    assert apply(owner, scope, [{**block, "title": "Changed"}], request_id).status_code == 409
    current = owner.get(f"{API}/time-tracking/tracker").json()
    assert tracker["active"] == current["active"] is None
    assert tracker["revision"] == current["revision"]
    assert result.json()["plans"][0]["frequency"] == "none"
    assert db.scalar(select(func.count()).select_from(CalendarApplicationRecord)) == 1


def test_fresh_overlap_and_internal_overlap_roll_back_the_entire_batch(owner, db):
    scope, block = setup_calendar(owner)
    assert apply(owner, scope, [block, {**block, "title": "Conflicting"}]).status_code == 409
    assert db.scalar(select(func.count()).select_from(SchedulePlan)) == 0
    added = apply(owner, scope, [block]).json()
    earlier = {**block, "start_minute": 480, "end_minute": 540}
    response = apply(owner, scope, [earlier, block])
    assert response.status_code == 409 and "overlaps" in response.text
    assert db.scalar(select(func.count()).select_from(SchedulePlan)) == 1
    assert owner.get(f"{API}/schedule/plans/{added['plans'][0]['id']}").status_code == 200


def test_only_active_owned_activities_future_dates_and_valid_hours_are_accepted(owner):
    scope, block = setup_calendar(owner)
    assert apply(owner, scope, [{**block, "activity_id": str(uuid4())}]).status_code == 422
    assert apply(owner, scope, [{**block, "start_minute": 300}]).status_code == 422
    assert apply(owner, scope, [{**block, "date": "2099-01-01"}]).status_code == 422
    yesterday = (datetime.now(UTC) - timedelta(days=1)).date().isoformat()
    assert (
        apply(
            owner, {**scope, "start": yesterday, "end": yesterday}, [{**block, "date": yesterday}]
        ).status_code
        == 422
    )
    activity = owner.get(f"{API}/time-tracking/activities").json()[0]
    archived = owner.put(
        f"{API}/time-tracking/activities/{activity['id']}",
        json={
            **activity,
            "archived": True,
        },
    )
    assert archived.status_code == 200, archived.text
    assert apply(owner, scope, [block]).status_code == 422


def test_batch_undo_redo_is_atomic_and_protects_later_edits(owner, db):
    scope, block = setup_calendar(owner)
    second = {**block, "start_minute": 720, "end_minute": 780}
    result = apply(owner, scope, [block, second]).json()
    path = f"{API}/ai/calendar/applications/{result['request_id']}"
    undone = owner.put(path, json={"revision": result["revision"], "applied": False})
    assert undone.status_code == 200, undone.text
    assert not undone.json()["applied"]
    assert (
        db.scalar(
            select(func.count()).select_from(SchedulePlan).where(SchedulePlan.deleted_at.is_(None))
        )
        == 0
    )
    restored = owner.put(path, json={"revision": undone.json()["revision"], "applied": True})
    assert restored.status_code == 200
    plan = restored.json()["plans"][1]
    edited = owner.put(
        f"{API}/schedule/plans/{plan['id']}",
        json={
            **plan,
            "title": "Edited elsewhere",
            "scope": "series",
        },
    )
    assert edited.status_code == 200, edited.text
    rejected = owner.put(path, json={"revision": restored.json()["revision"], "applied": False})
    assert rejected.status_code == 409
    assert (
        db.scalar(
            select(func.count()).select_from(SchedulePlan).where(SchedulePlan.deleted_at.is_(None))
        )
        == 2
    )


def test_generation_rejects_invented_activity_ids(owner, monkeypatch):
    scope, block = setup_calendar(owner)

    async def answer(messages, info):
        yield {
            0: DeltaToolCall(
                name=info.output_tools[0].name,
                json_args=json.dumps(
                    {
                        "explanation": "A plan",
                        "blocks": [{**block, "activity_id": str(uuid4())}],
                    }
                ),
            )
        }

    monkeypatch.setattr(RunService, "model", lambda *_: FunctionModel(stream_function=answer))
    response = owner.post(f"{API}/ai/calendar/runs", json={**scope, "instructions": "Plan"})
    events = [json.loads(line) for line in response.text.splitlines()]
    assert events[-1]["type"] == "error"
    assert "existing active activity" in events[-1]["message"]


def test_dst_gap_is_rejected(owner):
    scope, block = setup_calendar(owner)
    day = "2027-03-28"
    response = apply(
        owner,
        {
            **scope,
            "start": day,
            "end": day,
            "timezone": "Europe/Berlin",
            "start_minute": 0,
        },
        [{**block, "date": day, "start_minute": 150, "end_minute": 210}],
    )
    assert response.status_code == 422
    assert "does not exist" in response.text
