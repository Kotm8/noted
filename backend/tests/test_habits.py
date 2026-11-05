import json
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from sqlalchemy import select

from app.auth.models import User
from app.habits.models import Habit
from app.habits.service import next_reminder
from app.habits.worker import dispatch_habits
from app.time_tracking.models import TimeSession
from tests.conftest import API


def fields(**changes):
    return {
        "name": "Read",
        "kind": "count",
        "goal": 8,
        "unit": "pages",
        "period": "Anytime",
        "weekdays": list(range(7)),
        "timezone": "UTC",
        "starts_on": (datetime.now(UTC) - timedelta(days=3)).date().isoformat(),
        **changes,
    }


def create(owner, **changes):
    response = owner.post(f"{API}/habits", json=fields(**changes))
    assert response.status_code == 201, response.text
    return response.json()


def test_manual_progress_revisions_and_reminders_default_off(owner):
    habit = create(owner)
    assert habit["reminder_minute"] is None
    day = datetime.now(UTC).date().isoformat()
    path = f"{API}/habits/{habit['id']}/progress"
    first = owner.put(path, json={"day": day, "value": 1, "revision": 0})
    assert first.status_code == 200, first.text
    assert owner.put(path, json={"day": day, "value": 2, "revision": 0}).status_code == 409
    assert owner.put(path, json={"day": day, "value": 8, "revision": 1}).status_code == 200
    board = owner.get(f"{API}/habits", params={"start": day, "end": day}).json()
    assert board["progress"][0]["value"] == 8
    updated = owner.put(
        f"{API}/habits/{habit['id']}", json={**habit, "goal": 12, "reminder_minute": 1110}
    )
    assert updated.status_code == 200, updated.text
    assert owner.put(f"{API}/habits/{habit['id']}", json=habit).status_code == 409
    assert owner.delete(f"{API}/habits/{uuid4()}?revision=1").status_code == 404


def test_linked_minutes_split_at_local_midnight_and_cannot_be_written(owner, db):
    activity = owner.post(
        f"{API}/time-tracking/activities",
        json={"name": "Reading", "icon": "BookOpen", "color": "#e2c15a"},
    ).json()
    day = datetime.now(UTC).date() - timedelta(days=1)
    habit = create(
        owner,
        kind="time",
        goal=20,
        activity_id=activity["id"],
        timezone="Europe/Moscow",
        starts_on=(day - timedelta(days=2)).isoformat(),
    )
    midnight = datetime.combine(day, datetime.min.time(), UTC) - timedelta(hours=3)
    db.add(
        TimeSession(
            owner_id=db.scalar(select(User.id)),
            activity_id=UUID(activity["id"]),
            started_at=midnight - timedelta(minutes=10),
            ended_at=midnight + timedelta(minutes=20),
            revision=1,
        )
    )
    db.commit()
    board = owner.get(
        f"{API}/habits",
        params={"start": (day - timedelta(days=1)).isoformat(), "end": day.isoformat()},
    ).json()
    assert [item["value"] for item in board["progress"]] == [10, 20]
    assert (
        owner.put(
            f"{API}/habits/{habit['id']}/progress",
            json={"day": day.isoformat(), "value": 500, "revision": 0},
        ).status_code
        == 422
    )


def test_reminder_dst_and_selected_days():
    habit = Habit(
        name="Read",
        kind="check",
        goal=1,
        unit="times",
        period="Anytime",
        weekdays=list(range(7)),
        starts_on=datetime(2026, 3, 28).date(),
        timezone="Europe/Berlin",
        reminder_minute=150,
        archived=False,
    )
    assert next_reminder(habit, datetime(2026, 3, 28, 3, tzinfo=UTC)) == datetime(
        2026, 3, 30, 0, 30, tzinfo=UTC
    )
    habit.weekdays = [0, 4]
    assert next_reminder(habit, datetime(2026, 3, 30, 1, tzinfo=UTC)) == datetime(
        2026, 4, 3, 0, 30, tzinfo=UTC
    )


def test_habit_delivery_uses_existing_router_once_and_skips_completed(owner, db, app, monkeypatch):
    habit = create(owner, reminder_minute=540)
    now = datetime.now(UTC)
    record = db.get(Habit, UUID(habit["id"]))
    record.next_reminder_at = now - timedelta(seconds=10)
    db.commit()
    delivered = []
    monkeypatch.setattr(
        "app.habits.worker.deliver", lambda *args, **kwargs: delivered.append(json.loads(args[6]))
    )
    dispatch_habits(app.state.engine, app.state.settings, now)
    assert len(delivered) == 1
    assert delivered[0]["kind"] == "habit"
    assert delivered[0]["url"].startswith("/habits?")
    day = now.date().isoformat()
    response = owner.put(
        f"{API}/habits/{habit['id']}/progress", json={"day": day, "value": 8, "revision": 0}
    )
    assert response.status_code == 200, response.text
    dispatch_habits(app.state.engine, app.state.settings, now + timedelta(seconds=20))
    assert len(delivered) == 1


def test_shared_assistant_edits_are_atomic_and_retry_safe(owner):
    habit = create(owner)
    day = (datetime.now(UTC) + timedelta(days=1)).date().isoformat()
    scope = {"start": day, "end": day, "timezone": "UTC", "start_minute": 0, "end_minute": 1440}
    change = {
        "id": habit["id"],
        "revision": habit["revision"],
        "fields": fields(name="Read more", goal=12),
    }
    request_id = str(uuid4())
    payload = {
        **scope,
        "explanation": "Increase reading",
        "habits": [change],
        "plans": [],
        "request_id": request_id,
    }
    response = owner.post(f"{API}/ai/assistant/apply", json=payload)
    assert response.status_code == 200, response.text
    assert owner.post(f"{API}/ai/assistant/apply", json=payload).json() == response.json()
    payload["request_id"] = str(uuid4())
    assert owner.post(f"{API}/ai/assistant/apply", json=payload).status_code == 409
    activity = owner.post(
        f"{API}/time-tracking/activities",
        json={"name": "Work", "icon": "Code2", "color": "#e2c15a"},
    ).json()
    plan = {
        "activity_id": activity["id"],
        "title": "Work",
        "date": day,
        "start_minute": 600,
        "end_minute": 660,
        "timezone": "UTC",
    }
    created = owner.post(f"{API}/schedule/plans", json=plan).json()
    payload = {
        **scope,
        "explanation": "Conflicting changes",
        "habits": [{"id": habit["id"], "revision": 2, "fields": fields(name="Should roll back")}],
        "plans": [{"id": None, "revision": None, "fields": plan}],
        "request_id": str(uuid4()),
    }
    assert owner.post(f"{API}/ai/assistant/apply", json=payload).status_code == 409
    board = owner.get(f"{API}/habits", params={"start": day, "end": day}).json()
    assert board["habits"][0]["name"] == "Read more"
    payload = {
        **scope,
        "explanation": "Move work",
        "habits": [],
        "plans": [
            {
                "id": created["id"],
                "revision": created["revision"],
                "fields": {**plan, "start_minute": 700, "end_minute": 760},
            }
        ],
        "request_id": str(uuid4()),
    }
    result = owner.post(f"{API}/ai/assistant/apply", json=payload)
    assert result.status_code == 200, result.text
    assert owner.get(f"{API}/schedule/plans/{created['id']}").json()["start_minute"] == 700


def test_shared_assistant_uses_real_habits_and_structured_proposals(owner, monkeypatch):
    from pydantic_ai.models.function import DeltaToolCall, FunctionModel

    from app.ai.runs import RunService

    habit = create(owner)
    day = datetime.now(UTC).date().isoformat()

    async def answer(messages, info):
        assert habit["id"] in str(messages)
        assert "Linked" in str(messages) or "linked" in str(messages)
        yield {
            0: DeltaToolCall(
                name=info.output_tools[0].name,
                json_args=json.dumps(
                    {
                        "explanation": "Increase the target",
                        "habits": [
                            {
                                "id": habit["id"],
                                "revision": habit["revision"],
                                "fields": fields(goal=12),
                            }
                        ],
                        "plans": [],
                    }
                ),
            )
        }

    monkeypatch.setattr(RunService, "model", lambda *_: FunctionModel(stream_function=answer))
    response = owner.post(
        f"{API}/ai/assistant",
        json={
            "start": day,
            "end": day,
            "timezone": "UTC",
            "start_minute": 0,
            "end_minute": 1440,
            "instructions": "Increase the reading target",
            "history": [],
        },
    )
    events = [json.loads(line) for line in response.text.splitlines()]
    assert events[-1]["type"] == "done", events
    assert events[-1]["output"]["habits"][0]["fields"]["goal"] == 12
    assert (
        owner.get(f"{API}/habits", params={"start": day, "end": day}).json()["habits"][0]["goal"]
        == 8
    )


def test_habits_backup_roundtrip(owner):
    from tests.test_backups import export, upload

    habit = create(owner, reminder_minute=1110)
    day = datetime.now(UTC).date().isoformat()
    owner.put(f"{API}/habits/{habit['id']}/progress", json={"day": day, "value": 4, "revision": 0})
    ready, raw = export(owner)
    assert ready["counts"]["habits"] == 1
    preview = upload(owner, raw)
    assert preview.status_code == 200, preview.text
    imported = owner.post(
        f"{API}/backups/import",
        json={
            "token": preview.json()["token"],
            "mode": "replace",
            "confirmation": "REPLACE MY NOTES",
        },
    )
    assert imported.status_code == 200, imported.text
    board = owner.get(f"{API}/habits", params={"start": day, "end": day}).json()
    assert board["habits"][0]["reminder_minute"] == 1110
    assert board["progress"][0]["value"] == 4
