import io
import json
import zipfile
from concurrent.futures import ThreadPoolExecutor
from uuid import UUID, uuid4

import pytest
from sqlalchemy import func, select

from app.core.errors import NotFoundError
from app.notes.documents.models import ChannelDocument
from app.notes.documents.schemas import DocumentUpdate
from app.notes.documents.service import DocumentService
from tests.conftest import API
from tests.test_backups import export, rewrite, upload


def document_channel(owner, channel):
    result = owner.post(
        f"{API}/workspaces/{channel['workspace_id']}/channels",
        json={"name": "Project handbook", "kind": "document"},
    )
    assert result.status_code == 201, result.text
    return result.json()


def test_document_opens_empty_saves_markdown_and_rejects_stale_edits(owner, channel, db):
    notes = document_channel(owner, channel)
    path = f"{API}/channels/{notes['id']}/document"
    initial = owner.get(path)
    assert initial.status_code == 200 and initial.json()["revision"] == 0
    assert initial.json()["content"] == ""
    assert db.scalar(select(func.count()).select_from(ChannelDocument)) == 0
    content = "# Handbook\n\n**Important**\n\n- [ ] Ship the app\n\n```python\nprint('hi')\n```"
    saved = owner.put(path, json={"content": content, "revision": 0})
    assert saved.status_code == 200, saved.text
    assert saved.json()["revision"] == 1
    assert owner.get(path).json()["content"] == content
    stale = owner.put(path, json={"content": "overwrite", "revision": 0})
    assert stale.status_code == 409 and "draft has been kept" in stale.text
    attachment = owner.post(
        f"{API}/channels/{notes['id']}/messages/with-files",
        data={"content": "file"},
        files=[("files", ("file.txt", b"fixture", "text/plain"))],
    )
    assert attachment.status_code == 422
    assert owner.get(path).json()["content"] == content
    assert owner.put(path, json={"content": "x" * 200001, "revision": 1}).status_code == 422
    assert (
        owner.post(f"{API}/channels/{notes['id']}/messages", json={"content": "chat"}).status_code
        == 422
    )
    assert (
        owner.post(f"{API}/channels/{notes['id']}/journal", json={"title": "entry"}).status_code
        == 422
    )
    assert owner.get(f"{API}/channels/{channel['id']}/document").status_code == 422
    renamed = owner.put(f"{API}/channels/{notes['id']}", json={"name": "Renamed handbook"})
    assert renamed.status_code == 200 and renamed.json()["kind"] == "document"
    assert (
        owner.put(
            f"{API}/channels/{notes['id']}", json={"name": "Chat", "kind": "note"}
        ).status_code
        == 422
    )


def test_first_document_save_is_serialized_between_devices(owner, channel):
    notes = document_channel(owner, channel)
    path = f"{API}/channels/{notes['id']}/document"
    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(
            pool.map(
                lambda value: owner.put(path, json={"content": value, "revision": 0}).status_code,
                ["first", "second"],
            )
        )
    assert sorted(outcomes) == [200, 409]
    assert owner.get(path).json()["content"] in {"first", "second"}


def test_documents_are_owner_scoped_searchable_and_deleted_with_channel(owner, channel, db):
    notes = document_channel(owner, channel)
    path = f"{API}/channels/{notes['id']}/document"
    owner.put(path, json={"content": "Unique orchard plan", "revision": 0})
    result = owner.get(f"{API}/search", params={"q": "orchard"}).json()
    assert result["total"] == 1
    assert result["items"][0]["kind"] == "document"
    assert result["items"][0]["channel_id"] == notes["id"]
    with pytest.raises(NotFoundError):
        DocumentService(db).get(UUID(notes["id"]), uuid4())
    with pytest.raises(NotFoundError):
        DocumentService(db).update(
            UUID(notes["id"]), uuid4(), DocumentUpdate(content="overwrite", revision=1)
        )
    assert owner.get(f"{API}/search", params={"q": "orchard"}).json()["total"] == 1
    assert owner.delete(f"{API}/channels/{notes['id']}").status_code == 204
    assert owner.get(path).status_code == 404
    assert owner.get(f"{API}/search", params={"q": "orchard"}).json()["total"] == 0


def test_document_backup_restores_content_and_rejects_invalid_placement(owner, channel):
    notes = document_channel(owner, channel)
    content = "# Portable note\n\n- [x] Keep this text"
    owner.put(f"{API}/channels/{notes['id']}/document", json={"content": content, "revision": 0})
    ready, raw = export(owner)
    assert ready["counts"]["documents"] == 1
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        data = json.loads(archive.read("content.json"))
        assert data["version"] == 5 and data["documents"][0]["content"] == content
        assert "author_id" not in data["documents"][0]
    for change in (
        lambda data: data.update(version=4),
        lambda data: data["documents"].append(data["documents"][0].copy()),
        lambda data: data["documents"][0].update(channel_id=channel["id"]),
    ):
        assert upload(owner, rewrite(raw, change)).status_code == 422
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
    found = owner.get(f"{API}/search", params={"q": "Portable note"}).json()["items"][0]
    restored_note = owner.get(f"{API}/channels/{found['channel_id']}/document").json()
    assert restored_note["content"] == content and restored_note["revision"] == 1
    assert found["channel_id"] != notes["id"]
