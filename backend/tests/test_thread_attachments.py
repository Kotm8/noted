import json
import zipfile
from io import BytesIO
from uuid import uuid4

from fastapi.testclient import TestClient
from PIL import Image

from tests.conftest import API
from tests.test_backups import export, upload


def test_thread_media_retry_search_backup_and_root_deletion(
    owner: TestClient, channel: dict
) -> None:
    root = owner.post(f"{API}/channels/{channel['id']}/messages", json={"content": "Root"}).json()
    image = BytesIO()
    Image.new("RGB", (32, 20), "red").save(image, "PNG")
    client_id = str(uuid4())
    files = [
        ("files", ("reply.png", image.getvalue(), "image/png")),
        ("files", ("reference.txt", b"thread document", "text/plain")),
    ]
    url = f"{API}/messages/{root['id']}/thread/with-files"
    response = owner.post(url, data={"content": "Media reply", "client_id": client_id}, files=files)
    assert response.status_code == 201, response.text
    reply = response.json()
    assert reply["thread_root_id"] == root["id"]
    assert len(reply["attachments"]) == 2
    assert (
        owner.post(
            url, data={"content": "Media reply", "client_id": client_id}, files=files
        ).json()["id"]
        == reply["id"]
    )
    thread = owner.get(f"{API}/messages/{root['id']}/thread").json()
    assert [item["id"] for item in thread["replies"]["items"]] == [reply["id"]]
    assert len(thread["replies"]["items"][0]["attachments"]) == 2
    assert [
        item["id"] for item in owner.get(f"{API}/channels/{channel['id']}/messages").json()["items"]
    ] == [root["id"]]
    result = owner.get(f"{API}/search", params={"q": "reference.txt"}).json()
    assert any(item["thread_root_id"] == root["id"] for item in result["items"])
    _, raw = export(owner)
    with zipfile.ZipFile(BytesIO(raw)) as archive:
        document = json.loads(archive.read("content.json"))
        assert len(document["attachments"]) == 2
        assert any(item.get("thread_root_id") == root["id"] for item in document["messages"])
    preview = upload(owner, raw)
    assert preview.status_code == 200, preview.text
    restored = owner.post(f"{API}/backups/import", json={"token": preview.json()["token"]})
    assert restored.status_code == 200, restored.text
    restored_workspace = next(
        item
        for item in owner.get(f"{API}/workspaces").json()
        if item["id"] != channel["workspace_id"]
    )
    restored_channel = owner.get(f"{API}/workspaces/{restored_workspace['id']}/channels").json()[0]
    restored_root = owner.get(f"{API}/channels/{restored_channel['id']}/messages").json()["items"][
        0
    ]
    restored_thread = owner.get(f"{API}/messages/{restored_root['id']}/thread").json()
    restored_attachment = restored_thread["replies"]["items"][0]["attachments"][0]
    assert owner.get(restored_attachment["original_url"]).content == image.getvalue()
    image_url = reply["attachments"][0]["original_url"]
    assert owner.get(image_url).content == image.getvalue()
    owner.delete(f"{API}/messages/{root['id']}")
    assert owner.get(image_url).status_code == 404


def test_thread_upload_rejects_missing_nested_roots_and_reminders(
    owner: TestClient, channel: dict
) -> None:
    root = owner.post(f"{API}/channels/{channel['id']}/messages", json={"content": "Root"}).json()
    reply = owner.post(f"{API}/messages/{root['id']}/thread", json={"content": "Reply"}).json()
    files = [("files", ("reply.txt", b"data", "text/plain"))]
    assert owner.post(f"{API}/messages/{uuid4()}/thread/with-files", files=files).status_code == 404
    assert (
        owner.post(f"{API}/messages/{reply['id']}/thread/with-files", files=files).status_code
        == 422
    )
    assert (
        owner.post(
            f"{API}/messages/{root['id']}/thread/with-files",
            files=files,
            data={"reminder": '{"due_at":"2099-01-01T12:00:00Z","timezone":"UTC"}'},
        ).status_code
        == 422
    )
    response = owner.post(f"{API}/messages/{root['id']}/thread/with-files", files=files)
    assert response.status_code == 201
    assert response.json()["content"] == ""
