from uuid import uuid4

from sqlalchemy import func, select

from app.schedule.models import SchedulePlan
from tests.conftest import API


def test_retrying_a_calendar_create_reuses_the_client_id(owner, db):
    activity = owner.post(f"{API}/time-tracking/activities", json={"name": "Reading"}).json()
    client_id = str(uuid4())
    body = {
        "client_id": client_id,
        "activity_id": activity["id"],
        "title": "Read",
        "date": "2026-11-02",
        "timezone": "UTC",
        "start_minute": 600,
        "end_minute": 660,
    }
    first = owner.post(f"{API}/schedule/plans", json=body)
    assert first.status_code == 201, first.text
    assert first.json()["id"] == client_id
    again = owner.post(f"{API}/schedule/plans", json=body)
    assert again.status_code == 201 and again.json() == first.json()
    assert db.scalar(select(func.count()).select_from(SchedulePlan)) == 1
    conflict = owner.post(f"{API}/schedule/plans", json={**body, "title": "Different"})
    assert conflict.status_code == 409
    assert db.scalar(select(func.count()).select_from(SchedulePlan)) == 1


def test_calendar_occurrences_include_the_series_start_without_another_request(owner):
    activity = owner.post(f"{API}/time-tracking/activities", json={"name": "Reading"}).json()
    owner.post(
        f"{API}/schedule/plans",
        json={
            "activity_id": activity["id"],
            "title": "Read",
            "date": "2026-11-02",
            "timezone": "UTC",
            "start_minute": 600,
            "end_minute": 660,
            "frequency": "daily",
        },
    )
    board = owner.get(
        f"{API}/schedule",
        params={
            "start": "2026-11-05T00:00:00Z",
            "end": "2026-11-06T00:00:00Z",
        },
    ).json()
    assert board["plans"][0]["date"] == "2026-11-05"
    assert board["plans"][0]["series_date"] == "2026-11-02"
