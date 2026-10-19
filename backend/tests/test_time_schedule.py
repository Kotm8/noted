import io
import json
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, date, datetime, timedelta
from uuid import uuid4

from fastapi.testclient import TestClient

from app.schedule.recurrence import instants, occurs_on
from app.schedule.schemas import PlanCreate
from tests.conftest import API
from tests.test_backups import export, upload


def activity(owner: TestClient, name: str = "Work") -> dict:
    response = owner.post(f"{API}/time-tracking/activities", json={"name": name})
    assert response.status_code == 201, response.text
    return response.json()


def test_tracker_switch_pause_stale_and_retry(owner: TestClient) -> None:
    first, second = activity(owner), activity(owner, "Study")
    initial = owner.get(f"{API}/time-tracking/tracker").json()
    command = {
        "action": "start",
        "activity_id": first["id"],
        "revision": initial["revision"],
        "request_id": str(uuid4()),
    }
    started = owner.post(f"{API}/time-tracking/tracker", json=command)
    assert started.status_code == 200, started.text
    current = started.json()
    retry = owner.post(f"{API}/time-tracking/tracker", json=command).json()
    assert retry["active"]["id"] == current["active"]["id"]
    switched = owner.post(
        f"{API}/time-tracking/tracker",
        json={
            **command,
            "activity_id": second["id"],
            "revision": current["revision"],
            "request_id": str(uuid4()),
        },
    ).json()
    assert switched["active"]["activity_id"] == second["id"]
    assert owner.post(f"{API}/time-tracking/tracker", json=command).status_code == 409
    paused = owner.post(
        f"{API}/time-tracking/tracker",
        json={"action": "pause", "revision": switched["revision"], "request_id": str(uuid4())},
    ).json()
    assert paused["active"] is None and paused["paused_activity_id"] == second["id"]
    resumed = owner.post(
        f"{API}/time-tracking/tracker",
        json={"action": "resume", "revision": paused["revision"], "request_id": str(uuid4())},
    ).json()
    assert resumed["active"]["activity_id"] == second["id"]
    archived = owner.put(
        f"{API}/time-tracking/activities/{second['id']}", json={**second, "archived": True}
    )
    assert archived.status_code == 200, archived.text
    assert owner.get(f"{API}/time-tracking/tracker").json()["active"] is None


def test_schedule_repeats_overrides_and_preferences(owner: TestClient) -> None:
    item = activity(owner)
    plan = {
        "activity_id": item["id"],
        "title": "Monday and Friday",
        "date": "2026-10-19",
        "start_minute": 540,
        "end_minute": 600,
        "timezone": "Europe/Moscow",
        "frequency": "biweekly",
        "weekdays": [0, 4],
    }
    response = owner.post(f"{API}/schedule/plans", json=plan)
    assert response.status_code == 201, response.text
    created = response.json()
    board = owner.get(
        f"{API}/schedule", params={"start": "2026-10-19T00:00:00Z", "end": "2026-11-03T00:00:00Z"}
    )
    assert board.status_code == 200, board.text
    assert [entry["occurrence_date"] for entry in board.json()["plans"]] == [
        "2026-10-19",
        "2026-10-23",
        "2026-11-02",
    ]
    changed = owner.put(
        f"{API}/schedule/plans/{created['id']}",
        json={
            **plan,
            "date": "2026-10-24",
            "start_minute": 600,
            "end_minute": 660,
            "scope": "occurrence",
            "occurrence_date": "2026-10-23",
            "revision": 1,
        },
    )
    assert changed.status_code == 200, changed.text
    assert (
        owner.put(f"{API}/schedule/plans/{created['id']}", json={**plan, "revision": 1}).status_code
        == 409
    )
    moved = owner.get(
        f"{API}/schedule", params={"start": "2026-10-24T00:00:00Z", "end": "2026-10-25T00:00:00Z"}
    ).json()["plans"]
    assert len(moved) == 1 and moved[0]["date"] == "2026-10-24"
    reset = owner.delete(
        f"{API}/schedule/plans/{created['id']}",
        params={"revision": 2, "occurrence_date": "2026-10-23", "reset": True},
    )
    assert reset.status_code == 200, reset.text
    tracker = owner.get(f"{API}/time-tracking/tracker").json()
    settings = owner.put(
        f"{API}/time-tracking/preferences",
        json={
            "start_minute": 360,
            "end_minute": 1440,
            "timezone": "Europe/Moscow",
            "revision": tracker["revision"],
        },
    )
    assert settings.status_code == 200, settings.text
    assert owner.get(f"{API}/time-tracking/tracker").json()["preferences"]["start_minute"] == 360
    assert (
        owner.put(
            f"{API}/time-tracking/preferences",
            json={"start_minute": 600, "end_minute": 540, "revision": settings.json()["revision"]},
        ).status_code
        == 422
    )


def test_upcoming_flags_exclude_completed_and_deleted(
    owner: TestClient, channel: dict[str, str]
) -> None:
    now = datetime.now(UTC)
    due = now + timedelta(days=1)
    response = owner.post(
        f"{API}/channels/{channel['id']}/messages",
        json={
            "content": "Read the chapter",
            "reminder": {"due_at": due.isoformat(), "timezone": "UTC"},
        },
    )
    assert response.status_code == 201, response.text
    message = response.json()
    params = {"start": now.isoformat(), "end": (now + timedelta(days=3)).isoformat()}
    result = owner.get(f"{API}/schedule", params=params)
    assert result.status_code == 200, result.text
    assert result.json()["reminders"][0]["message_id"] == message["id"]
    owner.delete(f"{API}/messages/{message['id']}")
    assert owner.get(f"{API}/schedule", params=params).json()["reminders"] == []


def test_dst_and_month_end_recurrence() -> None:
    item = PlanCreate(
        activity_id=uuid4(),
        title="Monthly",
        date=date(2026, 1, 31),
        start_minute=540,
        end_minute=600,
        timezone="Europe/Berlin",
        frequency="monthly",
    )
    assert not occurs_on(item, date(2026, 2, 28))
    assert occurs_on(item, date(2026, 3, 31))
    spring = item.model_copy(
        update={"date": date(2026, 3, 29), "start_minute": 150, "end_minute": 210}
    )
    assert instants(spring, spring.date) is None


def test_two_devices_cannot_start_two_timers(owner: TestClient) -> None:
    item = activity(owner)
    revision = owner.get(f"{API}/time-tracking/tracker").json()["revision"]

    def start(_: int) -> int:
        return owner.post(
            f"{API}/time-tracking/tracker",
            json={
                "action": "start",
                "activity_id": item["id"],
                "revision": revision,
                "request_id": str(uuid4()),
            },
        ).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(start, range(2))) == [200, 409]


def test_tracking_backup_restores_history_and_exceptions_without_starting_timer(
    owner: TestClient,
) -> None:
    item = activity(owner)
    current = owner.get(f"{API}/time-tracking/tracker").json()
    response = owner.post(
        f"{API}/time-tracking/tracker",
        json={
            "action": "start",
            "activity_id": item["id"],
            "revision": current["revision"],
            "request_id": str(uuid4()),
        },
    )
    assert response.status_code == 200
    plan = {
        "activity_id": item["id"],
        "title": "Daily work",
        "date": "2026-10-19",
        "start_minute": 540,
        "end_minute": 600,
        "timezone": "Europe/Moscow",
        "frequency": "daily",
    }
    created = owner.post(f"{API}/schedule/plans", json=plan).json()
    changed = owner.put(
        f"{API}/schedule/plans/{created['id']}",
        json={
            **plan,
            "title": "Specific work",
            "scope": "occurrence",
            "occurrence_date": "2026-10-21",
            "date": "2026-10-21",
            "revision": created["revision"],
        },
    )
    assert changed.status_code == 200
    ready, raw = export(owner)
    assert ready["counts"]["activities"] == 1 and ready["counts"]["time_sessions"] == 1
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        metadata = json.loads(archive.read("content.json"))
        assert metadata["version"] == 4
        assert "owner_id" not in metadata["activities"][0]
        assert "preferences" not in metadata
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
    board = owner.get(
        f"{API}/schedule", params={"start": "2026-10-21T00:00:00Z", "end": "2026-10-22T00:00:00Z"}
    ).json()
    assert board["plans"][0]["title"] == "Specific work"
    assert owner.get(f"{API}/time-tracking/activities").json()[0]["id"] != item["id"]


def test_history_correction_rejects_overlaps_and_stale_deletes(owner: TestClient) -> None:
    item = activity(owner)
    state = owner.get(f"{API}/time-tracking/tracker").json()
    now = datetime.now(UTC)
    identifiers = []
    for _ in range(2):
        started = owner.post(
            f"{API}/time-tracking/tracker",
            json={
                "action": "start",
                "activity_id": item["id"],
                "revision": state["revision"],
                "request_id": str(uuid4()),
            },
        ).json()
        identifiers.append(started["active"]["id"])
        state = owner.post(
            f"{API}/time-tracking/tracker",
            json={"action": "stop", "revision": started["revision"], "request_id": str(uuid4())},
        ).json()
    update = {
        "activity_id": item["id"],
        "started_at": (now - timedelta(hours=3)).isoformat(),
        "ended_at": (now - timedelta(hours=2)).isoformat(),
        "revision": 2,
    }
    first = owner.put(f"{API}/time-tracking/sessions/{identifiers[0]}", json=update)
    assert first.status_code == 200, first.text
    assert (
        owner.put(f"{API}/time-tracking/sessions/{identifiers[1]}", json=update).status_code == 409
    )
    assert (
        owner.delete(f"{API}/time-tracking/sessions/{identifiers[0]}?revision=2").status_code == 409
    )
    assert (
        owner.delete(f"{API}/time-tracking/sessions/{identifiers[0]}?revision=3").status_code == 204
    )
