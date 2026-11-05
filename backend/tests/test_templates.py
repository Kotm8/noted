from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import NotFoundError
from app.schedule.models import SchedulePlan
from app.templates.models import DayTemplate, NoteTemplate
from app.templates.repository import TemplateRepository
from tests.conftest import API
from tests.test_backups import export, upload


def activity(owner: TestClient, name: str = "Work") -> dict:
    response = owner.post(f"{API}/time-tracking/activities", json={"name": name})
    assert response.status_code == 201, response.text
    return response.json()


def day_template(owner: TestClient, activity_id: str, blocks: list[dict] | None = None) -> dict:
    response = owner.post(
        f"{API}/templates/days",
        json={
            "name": "Focused morning",
            "blocks": blocks
            if blocks is not None
            else [{"activity_id": activity_id, "start_minute": 540, "end_minute": 600}],
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_note_templates_preserve_whitespace_and_reject_stale_edits(
    owner: TestClient, db: Session
) -> None:
    content = "## My day\n\n\n  two spaces\n\n- [ ] a task  \n"
    response = owner.post(f"{API}/templates/notes", json={"name": "  Daily  ", "content": content})
    assert response.status_code == 201, response.text
    item = response.json()
    assert item["name"] == "Daily"
    assert item["content"] == content
    assert owner.get(f"{API}/templates/notes").json() == [item]
    changed = {"name": "Daily", "content": content + "\n", "revision": item["revision"]}
    assert owner.put(f"{API}/templates/notes/{item['id']}", json=changed).status_code == 200
    assert owner.put(f"{API}/templates/notes/{item['id']}", json=changed).status_code == 409
    assert owner.delete(f"{API}/templates/notes/{item['id']}?revision=1").status_code == 409
    repository = TemplateRepository(db)
    assert repository.list(NoteTemplate, uuid4()) == []
    with pytest.raises(NotFoundError):
        repository.get(NoteTemplate, uuid4(), UUID(item["id"]))
    assert owner.delete(f"{API}/templates/notes/{item['id']}?revision=2").status_code == 204


def test_apply_keeps_existing_plans_and_tracker_and_retries_once(
    owner: TestClient, db: Session
) -> None:
    work = activity(owner)
    item = day_template(owner, work["id"])
    plan = {
        "activity_id": work["id"],
        "title": "Already here",
        "date": "2030-01-07",
        "timezone": "UTC",
        "start_minute": 540,
        "end_minute": 570,
    }
    assert owner.post(f"{API}/schedule/plans", json=plan).status_code == 201
    before = owner.get(f"{API}/time-tracking/tracker").json()
    payload = {
        "date": "2030-01-07",
        "timezone": "Europe/Moscow",
        "revision": item["revision"],
        "request_id": str(uuid4()),
    }
    url = f"{API}/templates/days/{item['id']}/apply"
    response = owner.post(url, json=payload)
    assert response.status_code == 200, response.text
    assert response.json()["plans"][0]["frequency"] == "none"
    assert response.json()["plans"][0]["title"] == "Work"
    assert response.json()["plans"][0]["timezone"] == "Europe/Moscow"
    assert owner.post(url, json=payload).json() == response.json()
    assert owner.post(url, json=payload | {"date": "2030-01-08"}).status_code == 409
    assert db.scalar(select(func.count()).select_from(SchedulePlan)) == 2
    after = owner.get(f"{API}/time-tracking/tracker").json()
    assert (after["active"], after["paused_activity_id"], after["revision"]) == (
        before["active"],
        before["paused_activity_id"],
        before["revision"],
    )
    repository = TemplateRepository(db)
    assert repository.list(DayTemplate, uuid4()) == []
    with pytest.raises(NotFoundError):
        repository.get(DayTemplate, uuid4(), UUID(item["id"]))


def test_failed_apply_rolls_back_every_block(owner: TestClient, db: Session) -> None:
    work, study = activity(owner), activity(owner, "Study")
    item = day_template(
        owner,
        work["id"],
        [
            {"activity_id": work["id"], "start_minute": 540, "end_minute": 600},
            {"activity_id": study["id"], "start_minute": 600, "end_minute": 660},
        ],
    )
    archived = {key: study[key] for key in ("name", "icon", "color", "revision")}
    assert (
        owner.put(
            f"{API}/time-tracking/activities/{study['id']}", json=archived | {"archived": True}
        ).status_code
        == 200
    )
    response = owner.post(
        f"{API}/templates/days/{item['id']}/apply",
        json={"date": "2030-01-07", "timezone": "UTC", "revision": 1, "request_id": str(uuid4())},
    )
    assert response.status_code == 422, response.text
    assert db.scalar(select(func.count()).select_from(SchedulePlan)) == 0


def test_apply_rejects_nonexistent_dst_time_atomically(owner: TestClient, db: Session) -> None:
    work = activity(owner)
    item = day_template(
        owner,
        work["id"],
        [
            {"activity_id": work["id"], "start_minute": 60, "end_minute": 90},
            {"activity_id": work["id"], "start_minute": 150, "end_minute": 210},
        ],
    )
    response = owner.post(
        f"{API}/templates/days/{item['id']}/apply",
        json={
            "date": "2030-03-10",
            "timezone": "America/New_York",
            "revision": 1,
            "request_id": str(uuid4()),
        },
    )
    assert response.status_code == 422, response.text
    assert db.scalar(select(func.count()).select_from(SchedulePlan)) == 0


def test_capture_uses_visible_repeating_occurrence_and_local_times(owner: TestClient) -> None:
    work = activity(owner)
    response = owner.post(
        f"{API}/schedule/plans",
        json={
            "activity_id": work["id"],
            "title": "Regular work",
            "date": "2030-01-07",
            "timezone": "UTC",
            "start_minute": 540,
            "end_minute": 600,
            "frequency": "daily",
        },
    )
    assert response.status_code == 201, response.text
    item = response.json()
    changed = {
        key: item[key]
        for key in (
            "activity_id",
            "title",
            "date",
            "start_minute",
            "end_minute",
            "timezone",
            "frequency",
            "weekdays",
            "repeat_until",
            "revision",
        )
    }
    changed.update(
        date="2030-01-08",
        scope="occurrence",
        occurrence_date="2030-01-08",
        start_minute=600,
        end_minute=660,
        title="Different today",
    )
    assert owner.put(f"{API}/schedule/plans/{item['id']}", json=changed).status_code == 200
    captured = owner.post(
        f"{API}/templates/days/capture",
        json={"name": "My Tuesday", "date": "2030-01-08", "timezone": "Europe/Moscow"},
    )
    assert captured.status_code == 201, captured.text
    assert len(captured.json()["blocks"]) == 1
    block = captured.json()["blocks"][0]
    assert (block["title"], block["start_minute"], block["end_minute"]) == (
        "Different today",
        780,
        840,
    )


def test_template_backup_roundtrip_remaps_activity_and_keeps_markdown(owner: TestClient) -> None:
    work = activity(owner)
    day_template(owner, work["id"])
    raw_text = "\n## Exact\n\n  spaces  \n\n"
    assert (
        owner.post(
            f"{API}/templates/notes", json={"name": "Exact", "content": raw_text}
        ).status_code
        == 201
    )
    ready, raw = export(owner)
    assert ready["counts"]["day_templates"] == ready["counts"]["note_templates"] == 1
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
    new_work = owner.get(f"{API}/time-tracking/activities").json()[0]
    day = owner.get(f"{API}/templates/days").json()[0]
    assert new_work["id"] != work["id"]
    assert day["blocks"][0]["activity_id"] == new_work["id"]
    assert owner.get(f"{API}/templates/notes").json()[0]["content"] == raw_text


def test_templates_need_authentication_and_valid_activity(
    owner: TestClient, client: TestClient
) -> None:
    unknown = owner.post(
        f"{API}/templates/days",
        json={
            "name": "Bad",
            "blocks": [{"activity_id": str(uuid4()), "start_minute": 540, "end_minute": 600}],
        },
    )
    assert unknown.status_code == 404
    client.cookies.clear()
    assert client.get(f"{API}/templates/notes").status_code == 401
