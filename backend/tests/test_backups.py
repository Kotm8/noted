import io
import json
import zipfile
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.auth.models import Installation, User
from app.auth.schemas import LoginRequest
from app.auth.services.auth import AuthService
from app.core.errors import ConflictError
from app.workspaces.models import Workspace
from tests.conftest import API, TEST_PASSWORD


def export(owner: TestClient) -> tuple[dict, bytes]:
    response = owner.post(f"{API}/backups/export")
    assert response.status_code == 201, response.text
    ready = response.json()
    download = owner.get(ready["download_url"])
    assert download.status_code == 200
    return ready, download.content


def upload(owner: TestClient, raw: bytes):
    return owner.post(
        f"{API}/backups/preview", content=raw, headers={"Content-Type": "application/zip"}
    )


def rewrite(raw: bytes, update=None, extra=None) -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(raw)) as source, zipfile.ZipFile(output, "w") as target:
        for entry in source.infolist():
            content = source.read(entry)
            if entry.filename == "content.json" and update:
                data = json.loads(content)
                update(data)
                content = json.dumps(data).encode()
            target.writestr(entry.filename, content)
        if extra:
            target.writestr(*extra)
    return output.getvalue()


def test_backup_roundtrip_preserves_content_files_and_login(
    owner: TestClient, channel: dict, app: FastAPI
) -> None:
    server_directory = app.state.settings.storage_path / ".server"
    server_directory.mkdir(parents=True)
    private_config = server_directory / "firebase.json"
    private_config.write_text('{"private_key":"firebase-secret-must-not-leave-the-server"}')
    original = owner.post(
        f"{API}/channels/{channel['id']}/messages/with-files",
        data={"content": "keep this thought"},
        files=[("files", ("kept.txt", b"private bytes", "text/plain"))],
    ).json()
    ready, raw = export(owner)
    assert ready["counts"] == {
        "projects": 1,
        "categories": 1,
        "channels": 1,
        "messages": 1,
        "files": 1,
        "journals": 0,
        "documents": 0,
        "activities": 0,
        "time_sessions": 0,
        "schedule_plans": 0,
        "scheduled_messages": 0,
        "writing_prompts": 0,
    }
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        metadata = json.loads(archive.read("content.json"))
        assert "users" not in metadata
        assert "owner_id" not in metadata["workspaces"][0]
        assert "author_id" not in metadata["messages"][0]
        assert TEST_PASSWORD.encode() not in archive.read("content.json")
        assert b"firebase-secret-must-not-leave-the-server" not in archive.read("content.json")
        assert set(archive.namelist()) == {
            "content.json",
            metadata["attachments"][0]["file"]["path"],
        }
    preview = upload(owner, raw)
    assert preview.status_code == 200, preview.text
    token = preview.json()["token"]
    assert (
        owner.post(f"{API}/backups/import", json={"token": token, "mode": "replace"}).status_code
        == 422
    )
    response = owner.post(
        f"{API}/backups/import",
        json={"token": token, "mode": "replace", "confirmation": "REPLACE MY NOTES"},
    )
    assert response.status_code == 200, response.text
    projects = owner.get(f"{API}/workspaces").json()
    assert len(projects) == 1
    assert projects[0]["id"] != channel["workspace_id"]
    channels = owner.get(f"{API}/workspaces/{projects[0]['id']}/channels").json()
    notes = owner.get(f"{API}/channels/{channels[0]['id']}/messages").json()["items"]
    assert notes[0]["content"] == original["content"]
    assert notes[0]["created_at"] == original["created_at"]
    assert owner.get(notes[0]["attachments"][0]["download_url"]).content == b"private bytes"
    assert owner.get(f"{API}/auth/session").status_code == 200
    assert private_config.exists()
    assert owner.post(f"{API}/backups/import", json={"token": token}).status_code == 404


def test_large_attachments_survive_backup_restore(owner: TestClient, channel: dict) -> None:
    payload = b"x" * (26 * 1024 * 1024)
    response = owner.post(
        f"{API}/channels/{channel['id']}/messages/with-files",
        files=[
            ("files", ("first.bin", payload, "application/octet-stream")),
            ("files", ("second.bin", payload, "application/octet-stream")),
        ],
    )
    assert response.status_code == 201, response.text
    assert [item["size"] for item in response.json()["attachments"]] == [len(payload)] * 2
    _, raw = export(owner)
    preview = upload(owner, raw)
    assert preview.status_code == 200, preview.text
    restored = owner.post(f"{API}/backups/import", json={"token": preview.json()["token"]})
    assert restored.status_code == 200, restored.text
    project = next(
        item
        for item in owner.get(f"{API}/workspaces").json()
        if item["id"] != channel["workspace_id"]
    )
    restored_channel = owner.get(f"{API}/workspaces/{project['id']}/channels").json()[0]
    message = owner.get(f"{API}/channels/{restored_channel['id']}/messages").json()["items"][0]
    assert len(message["attachments"]) == 2
    for attachment in message["attachments"]:
        assert owner.get(attachment["download_url"]).content == payload


def test_backup_upload_rejects_over_1_gib_before_reading(owner: TestClient) -> None:
    response = owner.post(
        f"{API}/backups/preview",
        content=b"",
        headers={"Content-Length": str(1024 * 1024 * 1024 + 1)},
    )
    assert response.status_code == 413


def test_video_backup_roundtrip_and_mismatched_container_rejection(
    owner: TestClient, channel: dict
) -> None:
    content = (Path(__file__).parent / "fixtures" / "video.mp4").read_bytes()
    response = owner.post(
        f"{API}/channels/{channel['id']}/messages/with-files",
        files={"files": ("clip.mp4", content, "video/mp4")},
    )
    assert response.status_code == 201
    _, raw = export(owner)
    invalid = rewrite(raw, lambda data: data["attachments"][0].update(content_type="video/webm"))
    assert upload(owner, invalid).status_code == 422
    preview = upload(owner, raw)
    assert preview.status_code == 200, preview.text
    result = owner.post(f"{API}/backups/import", json={"token": preview.json()["token"]})
    assert result.status_code == 200, result.text
    project = next(
        item
        for item in owner.get(f"{API}/workspaces").json()
        if item["id"] != channel["workspace_id"]
    )
    imported_channel = owner.get(f"{API}/workspaces/{project['id']}/channels").json()[0]
    note = owner.get(f"{API}/channels/{imported_channel['id']}/messages").json()["items"][0]
    playback = owner.get(note["attachments"][0]["playback_url"], headers={"Range": "bytes=-16"})
    assert playback.status_code == 206
    assert playback.content == content[-16:]


def test_merge_creates_new_projects_and_preserves_existing(
    owner: TestClient, channel: dict
) -> None:
    owner.post(f"{API}/channels/{channel['id']}/messages", json={"content": "original"})
    _, raw = export(owner)
    token = upload(owner, raw).json()["token"]
    assert owner.post(f"{API}/backups/import", json={"token": token}).status_code == 200
    assert len(owner.get(f"{API}/workspaces").json()) == 2
    assert (
        owner.get(f"{API}/channels/{channel['id']}/messages").json()["items"][0]["content"]
        == "original"
    )


def test_tampered_and_unsafe_archives_never_change_content(
    owner: TestClient, channel: dict
) -> None:
    owner.post(
        f"{API}/channels/{channel['id']}/messages/with-files",
        data={"content": "original"},
        files=[("files", ("data.txt", b"safe", "text/plain"))],
    )
    _, raw = export(owner)
    invalid = [
        b"not a zip",
        rewrite(raw, extra=("../outside", b"bad")),
        rewrite(raw, lambda data: data.update(users=[{"password": "no"}])),
        rewrite(raw, lambda data: data["attachments"][0]["file"].update(sha256="0" * 64)),
        rewrite(
            raw,
            lambda data: data["messages"][0].update(
                channel_id="00000000-0000-0000-0000-000000000000"
            ),
        ),
    ]
    for archive in invalid:
        response = upload(owner, archive)
        assert response.status_code == 422, response.text
    assert len(owner.get(f"{API}/workspaces").json()) == 1


def test_backup_requests_need_auth_csrf_and_tokens_are_owner_bound(
    owner: TestClient, app: FastAPI
) -> None:
    ready, _ = export(owner)
    owner.headers.pop("X-CSRF-Token")
    assert owner.post(f"{API}/backups/export").status_code == 403
    assert upload(owner, b"invalid").status_code == 403
    owner.cookies.clear()
    assert owner.get(ready["download_url"]).status_code == 401
    assert owner.post(f"{API}/backups/export").status_code == 401


def test_modified_preview_cannot_replace_notes(
    owner: TestClient, channel: dict, app: FastAPI
) -> None:
    _, raw = export(owner)
    token = upload(owner, raw).json()["token"]
    directory = app.state.backups.directory / token
    (directory / "backup.zip").write_bytes(b"damaged")
    response = owner.post(
        f"{API}/backups/import",
        json={"token": token, "mode": "replace", "confirmation": "REPLACE MY NOTES"},
    )
    assert response.status_code == 422
    assert len(owner.get(f"{API}/workspaces").json()) == 1


def test_backup_can_be_imported_by_a_different_owner_without_source_credentials(
    owner: TestClient, channel: dict, db: Session
) -> None:
    owner.post(f"{API}/channels/{channel['id']}/messages", json={"content": "portable thought"})
    _, raw = export(owner)
    db.execute(delete(Workspace))
    db.execute(delete(User))
    installation = db.scalar(select(Installation))
    installation.claimed_at = None
    db.commit()
    AuthService(db).provision_owner(
        LoginRequest.model_validate(
            {"username": "destination-owner", "password": "a-different-destination-password"}
        )
    )
    owner.cookies.clear()
    login = owner.post(
        f"{API}/auth/login",
        json={"username": "destination-owner", "password": "a-different-destination-password"},
    )
    assert login.status_code == 200
    owner.headers["X-CSRF-Token"] = owner.cookies["noted_csrf"]
    preview = upload(owner, raw).json()
    result = owner.post(f"{API}/backups/import", json={"token": preview["token"]})
    assert result.status_code == 200, result.text
    assert owner.get(f"{API}/auth/session").json()["username"] == "destination-owner"
    projects = owner.get(f"{API}/workspaces").json()
    channels = owner.get(f"{API}/workspaces/{projects[0]['id']}/channels").json()
    assert (
        owner.get(f"{API}/channels/{channels[0]['id']}/messages").json()["items"][0]["content"]
        == "portable thought"
    )


def test_backup_operations_are_serialized_and_lock_releases_after_failure(app: FastAPI) -> None:
    cache = app.state.backups
    owner_id = uuid4()
    with cache.operation(owner_id), pytest.raises(ConflictError), cache.operation(owner_id):
        pass
    with cache.operation(owner_id):
        pass
