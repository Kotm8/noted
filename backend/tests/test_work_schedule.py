from fastapi.testclient import TestClient

from tests.conftest import API


def test_work_schedule_persists_overrides_and_rejects_stale_or_invalid_settings(
    owner: TestClient,
) -> None:
    path = f"{API}/time-tracking/preferences"
    tracker = owner.get(f"{API}/time-tracking/tracker").json()
    assert tracker["preferences"]["work_schedule"]["off_weekdays"] == [5, 6]
    schedule = {
        "mode": "cycle",
        "work_days": 2,
        "off_days": 2,
        "cycle_start": "2026-10-31",
        "off_weekdays": [0, 4],
        "overrides": {"2026-11-01": "off", "2026-11-03": "work"},
    }
    response = owner.put(
        path,
        json={**tracker["preferences"], "revision": tracker["revision"], "work_schedule": schedule},
    )
    assert response.status_code == 200, response.text
    saved = response.json()
    assert saved["preferences"]["work_schedule"] == schedule
    assert owner.get(f"{API}/time-tracking/tracker").json()["preferences"] == saved["preferences"]
    assert (
        owner.put(
            path, json={"revision": tracker["revision"], "work_schedule": schedule}
        ).status_code
        == 409
    )
    for invalid in (
        {**schedule, "cycle_start": None},
        {**schedule, "work_days": 0},
        {**schedule, "off_days": 32},
        {**schedule, "off_weekdays": [7]},
        {**schedule, "off_weekdays": [1, 1]},
        {**schedule, "overrides": {"2026-02-30": "off"}},
        {**schedule, "overrides": {"2026-11-01": "holiday"}},
    ):
        assert (
            owner.put(
                path, json={"revision": saved["revision"], "work_schedule": invalid}
            ).status_code
            == 422
        )
    legacy = owner.put(
        path,
        json={
            "revision": saved["revision"],
            "start_minute": 360,
            "end_minute": 1200,
            "timezone": "Europe/Moscow",
        },
    )
    assert legacy.status_code == 200, legacy.text
    assert legacy.json()["preferences"]["work_schedule"] == schedule
    reset = {**schedule, "mode": "weekly", "off_weekdays": [], "overrides": {}}
    response = owner.put(path, json={"revision": legacy.json()["revision"], "work_schedule": reset})
    assert response.status_code == 200, response.text
    assert response.json()["preferences"]["work_schedule"] == reset
    assert response.json()["preferences"]["timezone"] == "Europe/Moscow"
