from pathlib import Path
from uuid import UUID

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.notes.models import Attachment
from app.storage.media import detect_video_type
from tests.conftest import API

FIXTURES = Path(__file__).parent / "fixtures"


def test_media_detection_accepts_padded_webm_and_rejects_other_containers() -> None:
    header = (FIXTURES / "video.webm").read_bytes()[:4096]
    assert detect_video_type(header) == "video/webm"
    assert detect_video_type(header.replace(b"webm\0", b"mkv \0", 1)) is None
    for incomplete in (b"\x1a\x45\xdf\xa3", b"\x1a\x45\xdf\xa3\0", header[:15]):
        assert detect_video_type(incomplete) is None
    assert detect_video_type(b"\0\0\0\x14ftypM4A \0\0\0\0isom") is None
    assert detect_video_type(b"\0\0\0\x14ftypqt  \0\0\0\0qt  ") == "video/quicktime"


def upload_video(owner: TestClient, channel: dict, name: str = "video.mp4") -> tuple[dict, bytes]:
    content = (FIXTURES / name).read_bytes()
    response = owner.post(
        f"{API}/channels/{channel['id']}/messages/with-files",
        files={"files": (name, content, "application/octet-stream")},
    )
    assert response.status_code == 201, response.text
    return response.json()["attachments"][0], content


@pytest.mark.parametrize(
    "name, content_type", [("video.mp4", "video/mp4"), ("video.webm", "video/webm")]
)
def test_video_detection_playback_and_download(
    owner: TestClient, channel: dict, name: str, content_type: str
) -> None:
    attachment, content = upload_video(owner, channel, name)
    assert attachment["content_type"] == content_type
    assert attachment["preview_url"] is None
    playback = owner.get(attachment["playback_url"])
    assert playback.status_code == 200
    assert playback.content == content
    assert playback.headers["content-type"] == content_type
    assert playback.headers["accept-ranges"] == "bytes"
    assert playback.headers["content-length"] == str(len(content))
    assert playback.headers["content-disposition"].startswith("inline;")
    assert playback.headers["x-content-type-options"] == "nosniff"
    assert playback.headers["cache-control"] == "no-store"
    download = owner.get(attachment["download_url"])
    assert download.content == content
    assert download.headers["content-disposition"].startswith("attachment;")
    assert download.headers["content-type"] == "application/octet-stream"


def test_video_ranges_head_and_conditional_ranges(owner: TestClient, channel: dict) -> None:
    attachment, content = upload_video(owner, channel)
    url = attachment["playback_url"]
    size = len(content)
    for value, start, end in [
        ("bytes=0-1", 0, 1),
        ("bytes=15-78", 15, 78),
        ("bytes=900-", 900, size - 1),
        ("bytes=-29", size - 29, size - 1),
        (f"bytes=-{size + 1}", 0, size - 1),
        (f"bytes=12-{size + 99}", 12, size - 1),
    ]:
        response = owner.get(url, headers={"Range": value})
        assert response.status_code == 206
        assert response.content == content[start : end + 1]
        assert response.headers["content-range"] == f"bytes {start}-{end}/{size}"
        assert response.headers["content-length"] == str(end - start + 1)
    for value in [
        f"bytes={size}-",
        "bytes=20-10",
        "bytes=-0",
        "bytes=broken",
        "bytes=",
        "bytes=" + "9" * 100 + "-",
    ]:
        response = owner.get(url, headers={"Range": value})
        assert response.status_code == 416
        assert response.content == b""
        assert response.headers["content-range"] == f"bytes */{size}"
    for value in ["items=1-2", "bytes=0-1,10-11"]:
        response = owner.get(url, headers={"Range": value})
        assert response.status_code == 200
        assert response.content == content
    head = owner.head(url, headers={"Range": "bytes=0-1"})
    assert head.status_code == 200
    assert head.content == b""
    assert head.headers["content-length"] == str(size)
    for validator in [head.headers["etag"], head.headers["last-modified"]]:
        response = owner.get(url, headers={"Range": "bytes=0-1", "If-Range": validator})
        assert response.status_code == 206
        assert response.content == content[:2]
    for validator in [
        '"changed"',
        "Wed, 01 Jan 2020 00:00:00 GMT",
        "Tue, 01 Jan 2030 00:00:00 GMT",
        "broken",
    ]:
        response = owner.get(url, headers={"Range": "bytes=0-1", "If-Range": validator})
        assert response.status_code == 200
        assert response.content == content


def test_playback_checks_authentication_and_deleted_notes(
    owner: TestClient, channel: dict, app: FastAPI
) -> None:
    attachment, _ = upload_video(owner, channel)
    url = attachment["playback_url"]
    with TestClient(app, base_url="http://localhost") as anonymous:
        assert anonymous.get(url, headers={"Range": "bytes=0-1"}).status_code == 401
        assert anonymous.head(url).status_code == 401
    message = owner.get(f"{API}/channels/{channel['id']}/messages").json()["items"][0]
    assert owner.delete(f"{API}/messages/{message['id']}").status_code == 204
    assert owner.get(url, headers={"Range": "bytes=0-1"}).status_code == 404
    assert owner.head(url).status_code == 404


def test_legacy_videos_play_without_reuploading(
    owner: TestClient, channel: dict, db: Session
) -> None:
    attachment, content = upload_video(owner, channel)
    record = db.get(Attachment, UUID(attachment["id"]))
    assert record is not None
    record.content_type = "application/octet-stream"
    db.commit()
    restored = owner.get(f"{API}/channels/{channel['id']}/messages").json()["items"][0]
    response = owner.get(restored["attachments"][0]["playback_url"], headers={"Range": "bytes=-8"})
    assert response.status_code == 206
    assert response.headers["content-type"] == "video/mp4"
    assert response.content == content[-8:]


def test_a_video_filename_and_mime_do_not_make_html_playable(
    owner: TestClient, channel: dict
) -> None:
    response = owner.post(
        f"{API}/channels/{channel['id']}/messages/with-files",
        files={"files": ("spoof.mp4", b"<html>not a video</html>", "video/mp4")},
    )
    assert response.status_code == 201
    attachment = response.json()["attachments"][0]
    assert attachment["content_type"] == "application/octet-stream"
    assert owner.get(attachment["playback_url"]).status_code == 404
    assert (
        owner.get(attachment["download_url"]).headers["content-type"] == "application/octet-stream"
    )
