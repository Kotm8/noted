from io import BytesIO
from pathlib import Path
from tempfile import TemporaryFile
from uuid import uuid4

import anyio
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image
from starlette.datastructures import UploadFile

from app.core.errors import ContentTooLargeError
from app.storage.local import LocalFileStorage
from app.storage.uploads import UploadService
from tests.conftest import API


def animated_gif() -> bytes:
    output = BytesIO()
    frames = [Image.new("RGB", (8, 8), color) for color in ("red", "blue")]
    frames[0].save(
        output, format="GIF", save_all=True, append_images=frames[1:], duration=100, loop=0
    )
    return output.getvalue()


def test_uploads_preserve_gifs_and_protect_downloads(
    owner: TestClient, channel: dict[str, str], app: FastAPI
) -> None:
    image = animated_gif()
    response = owner.post(
        f"{API}/channels/{channel['id']}/messages/with-files",
        files=[
            ("files", ("animation.gif", image, "image/gif")),
            ("files", ("../notes.txt", b"keep this", "text/plain")),
        ],
    )
    assert response.status_code == 201
    note = response.json()
    assert note["content"] == ""
    first, second = note["attachments"]
    assert first["content_type"] == "image/gif"
    assert second["original_filename"] == "notes.txt"
    assert second["preview_url"] is None
    assert "storage_key" not in first
    preview = owner.get(first["preview_url"])
    assert preview.content == image
    assert Image.open(BytesIO(preview.content)).n_frames == 2
    download = owner.get(second["download_url"])
    assert download.content == b"keep this"
    assert download.headers["content-type"] == "application/octet-stream"
    assert "attachment;" in download.headers["content-disposition"]
    assert owner.get(f"{API}/attachments/{second['id']}/preview").status_code == 404
    assert owner.get(f"{API}/channels/{channel['id']}/messages").json()["items"][0] == note
    with TestClient(app, base_url="http://localhost") as anonymous:
        assert anonymous.get(first["preview_url"]).status_code == 401
        assert anonymous.get(second["download_url"]).status_code == 401
    assert owner.delete(f"{API}/messages/{note['id']}").status_code == 204
    assert owner.get(first["preview_url"]).status_code == 404


def test_failed_upload_batch_rolls_back_files_and_message(
    owner: TestClient, channel: dict[str, str], app: FastAPI
) -> None:
    response = owner.post(
        f"{API}/channels/{channel['id']}/messages/with-files",
        files=[
            ("files", ("valid.txt", b"valid", "text/plain")),
            ("files", ("invalid.png", b"not an image", "image/png")),
        ],
    )
    assert response.status_code == 422
    assert owner.get(f"{API}/channels/{channel['id']}/messages").json()["items"] == []
    assert not [path for path in app.state.settings.storage_path.rglob("*") if path.is_file()]
    missing = owner.post(
        f"{API}/channels/{uuid4()}/messages/with-files", files={"files": ("file.txt", b"content")}
    )
    assert missing.status_code == 404


def test_workspace_image_can_be_replaced_and_removed(
    owner: TestClient, channel: dict[str, str], app: FastAPI
) -> None:
    path = f"{API}/workspaces/{channel['workspace_id']}/icon"
    response = owner.put(path, files={"file": ("icon.gif", animated_gif(), "image/gif")})
    assert response.status_code == 200
    first_url = response.json()["icon_url"]
    assert Image.open(BytesIO(owner.get(first_url).content)).n_frames == 2
    response = owner.put(path, files={"file": ("new.gif", animated_gif(), "image/gif")})
    assert response.status_code == 200
    assert response.json()["icon_url"] != first_url
    assert len([file for file in app.state.settings.storage_path.rglob("*") if file.is_file()]) == 1
    invalid = owner.put(path, files={"file": ("bad.svg", b"<svg></svg>", "image/svg+xml")})
    assert invalid.status_code == 422
    assert owner.delete(path).json()["icon_url"] is None
    assert owner.get(path).status_code == 404
    assert not [file for file in app.state.settings.storage_path.rglob("*") if file.is_file()]


def test_upload_limits_and_csrf(owner: TestClient, channel: dict[str, str]) -> None:
    path = f"{API}/channels/{channel['id']}/messages/with-files"
    assert owner.post(path, files={"files": ("empty.txt", b"")}).status_code == 422
    assert (
        owner.post(
            path, content=b"", headers={"content-length": str(503 * 1024 * 1024)}
        ).status_code
        == 413
    )
    assert (
        owner.post(
            path, files={"files": ("file.txt", b"abc")}, headers={"X-CSRF-Token": "wrong"}
        ).status_code
        == 403
    )


def test_local_storage_cleans_partial_uploads_and_rejects_unsafe_keys(tmp_path: Path) -> None:
    async def check() -> None:
        storage = LocalFileStorage(tmp_path)
        identifier = uuid4().hex
        key = f"{identifier[:2]}/{identifier}"

        async def chunks():
            yield b"first"
            yield b"second"

        with pytest.raises(ContentTooLargeError):
            await storage.save(key, chunks(), 8)
        assert not await storage.exists(key)
        assert not list(tmp_path.rglob("*.part"))
        with pytest.raises(ValueError):
            await storage.exists("../outside")

    anyio.run(check)


def test_upload_accepts_250_mib_and_rejects_one_byte_over(tmp_path: Path) -> None:
    async def check() -> None:
        storage = LocalFileStorage(tmp_path)
        uploads = UploadService(storage)
        maximum = 250 * 1024 * 1024
        with TemporaryFile() as source:
            source.truncate(maximum)
            source.seek(maximum - 4)
            source.write(b"tail")
            source.seek(0)
            saved = await uploads.save(UploadFile(source, filename="large.bin", size=maximum))
            assert saved.size == maximum
            stored = tmp_path / saved.key
            assert stored.stat().st_size == maximum
            with stored.open("rb") as downloaded:
                downloaded.seek(-4, 2)
                assert downloaded.read() == b"tail"
            with pytest.raises(ContentTooLargeError, match="250 MB"):
                await uploads.save(UploadFile(source, filename="over.bin", size=maximum + 1))
            assert [path for path in tmp_path.rglob("*") if path.is_file()] == [stored]

    anyio.run(check)
