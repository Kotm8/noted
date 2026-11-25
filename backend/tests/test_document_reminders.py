import io
import json
import zipfile
from datetime import timedelta
from unittest.mock import Mock
from uuid import UUID, uuid4

from sqlalchemy import select, update

from app.core.config import Settings
from app.core.security import utc_now
from app.notes.documents.reminders.delivery import dispatch_document_reminders
from app.notes.documents.reminders.models import DocumentReminder
from app.notes.models import Message
from app.notifications.reconciliation import current
from tests.conftest import API
from tests.test_backups import export, upload
from tests.test_documents import document_channel
from tests.test_reminders import schedule, subscribe


def create(owner, channel, **fields):
    notes = document_channel(owner, channel)
    body = {"id": str(uuid4()), "name": "Call the dentist", **schedule(), **fields}
    path = f"{API}/channels/{notes['id']}/document/reminders"
    response = owner.post(path, json=body)
    assert response.status_code == 200, response.text
    return notes, response.json(), path, body


def test_named_document_reminders_retry_and_follow_the_document(owner, channel, db):
    notes, reminder, path, body = create(owner, channel)
    assert owner.post(path, json=body).json()["id"] == reminder["id"]
    assert len(owner.get(path).json()) == 1
    assert db.scalar(select(Message)) is None
    assert owner.post(path, json={**body, "name": "Different"}).status_code == 409
    assert (
        owner.post(
            f"{API}/channels/{channel['id']}/document/reminders", json={**body, "id": str(uuid4())}
        ).status_code
        == 422
    )
    endpoint = f"{API}/document-reminders/{reminder['id']}"
    done = owner.post(endpoint + "/actions", json={"action": "done", "revision": 1})
    assert done.json()["status"] == "done"
    assert (
        owner.post(endpoint + "/actions", json={"action": "snooze", "revision": 1}).status_code
        == 409
    )
    snoozed = owner.post(
        endpoint + "/actions", json={"action": "snooze", "revision": 2, "minutes": 15}
    )
    assert snoozed.json()["status"] == "active"
    assert owner.delete(endpoint + "?revision=3").status_code == 204
    assert owner.get(path).json() == []


def test_document_reminder_delivery_opens_note_and_reconciles(owner, channel, db, monkeypatch):
    notes, reminder, _, _ = create(owner, channel)
    subscribe(owner)
    identifier = UUID(reminder["id"])
    db.execute(
        update(DocumentReminder)
        .where(DocumentReminder.id == identifier)
        .values(due_at=utc_now() - timedelta(seconds=1))
    )
    db.commit()
    send = Mock(return_value="accepted")
    monkeypatch.setattr("app.notifications.delivery.send_firebase", send)
    settings = Settings(app_origin="https://noted.example.com")
    dispatch_document_reminders(db.get_bind(), settings)
    dispatch_document_reminders(db.get_bind(), settings)
    assert send.call_count == 1
    payload = json.loads(send.call_args.args[3])
    assert payload["body"] == "Call the dentist"
    assert payload["kind"] == "document"
    assert (
        payload["url"]
        == f"/w/{notes['workspace_id']}/c/{notes['id']}?documentReminder={identifier}"
    )
    row = db.get(DocumentReminder, identifier)
    assert current(db, row.owner_id, "document", identifier, 1)
    owner.post(
        f"{API}/document-reminders/{identifier}/actions", json={"action": "done", "revision": 1}
    )
    db.expire_all()
    assert not current(db, row.owner_id, "document", identifier, 1)


def test_document_reminders_and_inline_links_survive_backup(owner, channel, db):
    notes, reminder, _, _ = create(owner, channel, repeat="weekly")
    link = f"[Call the dentist](#reminder-{reminder['id']})"
    owner.put(f"{API}/channels/{notes['id']}/document", json={"content": link, "revision": 0})
    _, raw = export(owner)
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        content = json.loads(archive.read("content.json"))
    assert content["version"] == 15
    assert len(content["document_reminders"]) == 1
    preview = upload(owner, raw)
    restored = owner.post(
        f"{API}/backups/import", json={"token": preview.json()["token"], "mode": "merge"}
    )
    assert restored.status_code == 200, restored.text
    db.expire_all()
    rows = list(db.scalars(select(DocumentReminder)))
    assert len(rows) == 2
    other = next(item for item in rows if str(item.id) != reminder["id"])
    document = owner.get(f"{API}/channels/{other.channel_id}/document").json()
    assert f"#reminder-{other.id}" in document["content"]
    assert other.repeat == "weekly"


def test_document_reminders_are_owner_scoped(owner, channel, db):
    import pytest

    from app.core.errors import NotFoundError
    from app.notes.documents.reminders.service import DocumentReminderService

    _, reminder, _, _ = create(owner, channel)
    with pytest.raises(NotFoundError):
        DocumentReminderService(db).get(UUID(reminder["id"]), uuid4())
