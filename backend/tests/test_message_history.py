from uuid import uuid4

from fastapi.testclient import TestClient

from tests.conftest import API
from tests.test_backups import export, upload


def post(owner: TestClient, channel: dict[str, str], content: str, **values) -> dict:
    response = owner.post(
        f"{API}/channels/{channel['id']}/messages", json={"content": content, **values}
    )
    assert response.status_code == 201, response.text
    return response.json()


def edit(owner: TestClient, message: dict, content: str) -> dict:
    response = owner.put(f"{API}/messages/{message['id']}", json={"content": content})
    assert response.status_code == 200, response.text
    return response.json()


def test_edits_keep_earlier_versions_and_any_can_be_restored(
    owner: TestClient, channel: dict[str, str]
) -> None:
    message = post(owner, channel, "- [ ] Buy milk\nFirst draft")
    edit(owner, message, "- [x] Buy milk\nFirst draft")
    path = f"{API}/messages/{message['id']}/versions"
    assert owner.get(path).json() == []

    edit(owner, message, "- [x] Buy milk\nSecond draft")
    edit(owner, message, "- [x] Buy milk\nThird draft")
    versions = owner.get(path).json()
    assert [item["content"] for item in versions] == [
        "- [x] Buy milk\nSecond draft",
        "- [x] Buy milk\nFirst draft",
    ]

    first = versions[1]
    stale = owner.post(f"{path}/{first['id']}/restore", json={"expected_content": "something else"})
    assert stale.status_code == 409
    restored = owner.post(
        f"{path}/{first['id']}/restore",
        json={"expected_content": "- [x] Buy milk\nThird draft"},
    )
    assert restored.status_code == 200, restored.text
    assert restored.json()["content"] == "- [x] Buy milk\nFirst draft"
    assert owner.get(path).json()[0]["content"] == "- [x] Buy milk\nThird draft"
    assert owner.post(f"{path}/{uuid4()}/restore", json={}).status_code == 404


def test_a_resent_message_is_created_once(owner: TestClient, channel: dict[str, str]) -> None:
    client_id = str(uuid4())
    first = post(owner, channel, "Written offline", client_id=client_id)
    again = post(owner, channel, "Written offline", client_id=client_id)
    assert again["id"] == first["id"]
    other = post(owner, channel, "Another one", client_id=str(uuid4()))
    items = owner.get(f"{API}/channels/{channel['id']}/messages").json()["items"]
    assert [item["id"] for item in items] == [first["id"], other["id"]]
    reply_id = str(uuid4())
    replies = [
        owner.post(
            f"{API}/messages/{first['id']}/thread",
            json={"content": "A reply written offline", "client_id": reply_id},
        )
        for _ in range(2)
    ]
    assert all(response.status_code == 201 for response in replies), replies[0].text
    assert replies[0].json()["id"] == replies[1].json()["id"]


def test_backups_keep_message_history(owner: TestClient, channel: dict[str, str]) -> None:
    message = post(owner, channel, "Before")
    edit(owner, message, "After")
    _, raw = export(owner)
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
    channels = owner.get(f"{API}/workspaces").json()
    assert channels
    note = next(
        item
        for workspace in channels
        for listed in owner.get(f"{API}/workspaces/{workspace['id']}/channels").json()
        for item in owner.get(f"{API}/channels/{listed['id']}/messages").json()["items"]
    )
    assert note["content"] == "After"
    versions = owner.get(f"{API}/messages/{note['id']}/versions").json()
    assert [item["content"] for item in versions] == ["Before"]


def test_a_resent_upload_is_created_once(owner: TestClient, channel: dict[str, str]) -> None:
    client_id = str(uuid4())
    sent = [
        owner.post(
            f"{API}/channels/{channel['id']}/messages/with-files",
            data={"content": "Offline file", "client_id": client_id},
            files=[("files", ("notes.txt", b"kept", "text/plain"))],
        )
        for _ in range(2)
    ]
    assert all(response.status_code == 201 for response in sent), sent[0].text
    assert sent[0].json()["id"] == sent[1].json()["id"]
    items = owner.get(f"{API}/channels/{channel['id']}/messages").json()["items"]
    assert len(items) == 1
