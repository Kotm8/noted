from fastapi.testclient import TestClient

from tests.conftest import API
from tests.test_backups import export, upload


def test_threads_stay_out_of_the_channel_and_support_pagination(
    owner: TestClient, channel: dict
) -> None:
    path = f"{API}/channels/{channel['id']}/messages"
    root = owner.post(path, json={"content": "A parent note"}).json()
    thread = f"{API}/messages/{root['id']}/thread"
    replies = [owner.post(thread, json={"content": f"Reply {index}"}) for index in range(3)]
    assert all(reply.status_code == 201 for reply in replies)
    notes = owner.get(path).json()["items"]
    assert len(notes) == 1 and notes[0]["reply_count"] == 3
    latest = owner.get(thread, params={"limit": 2}).json()
    assert len(latest["replies"]["items"]) == 2
    older = owner.get(thread, params={"before": latest["replies"]["next_cursor"]}).json()
    assert older["replies"]["items"][0]["content"] == "Reply 0"
    reply_id = replies[0].json()["id"]
    anchor = owner.get(thread, params={"around": reply_id, "limit": 1}).json()
    assert anchor["replies"]["items"][0]["id"] == reply_id
    following = owner.get(thread, params={"after": anchor["replies"]["newer_cursor"]}).json()
    assert [item["content"] for item in following["replies"]["items"]] == ["Reply 1", "Reply 2"]
    assert (
        owner.get(
            thread, params={"around": reply_id, "before": latest["replies"]["next_cursor"]}
        ).status_code
        == 422
    )
    assert (
        owner.post(f"{API}/messages/{reply_id}/thread", json={"content": "Nested"}).status_code
        == 422
    )
    assert owner.get(path, params={"around": reply_id}).status_code == 404
    assert owner.delete(f"{API}/messages/{root['id']}").status_code == 204
    assert owner.get(thread).status_code == 404
    assert (
        owner.put(f"{API}/messages/{reply_id}", json={"content": "Lost reply"}).status_code == 404
    )


def test_message_checkbox_updates_do_not_overwrite_newer_content(
    owner: TestClient, channel: dict
) -> None:
    original = "- [ ] Pack charger"
    message = owner.post(
        f"{API}/channels/{channel['id']}/messages", json={"content": original}
    ).json()
    path = f"{API}/messages/{message['id']}"
    updated = owner.put(path, json={"content": "- [x] Pack charger", "expected_content": original})
    assert updated.status_code == 200
    stale = owner.put(
        path, json={"content": "- [ ] Changed elsewhere", "expected_content": original}
    )
    assert stale.status_code == 409
    assert (
        owner.get(f"{API}/channels/{channel['id']}/messages").json()["items"][0]["content"]
        == "- [x] Pack charger"
    )


def test_journal_entries_are_named_and_revision_checked(owner: TestClient, channel: dict) -> None:
    journal = owner.post(
        f"{API}/workspaces/{channel['workspace_id']}/channels",
        json={"name": "journal", "kind": "journal"},
    ).json()
    path = f"{API}/channels/{journal['id']}/journal"
    created = owner.post(path, json={"title": "Morning pages"})
    assert created.status_code == 201, created.text
    entry = created.json()
    endpoint = f"{API}/journal/{entry['id']}"
    updated = owner.put(
        endpoint, json={"title": "Sunday", "content": "- [ ] Read\n- [x] Walk", "revision": 1}
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["revision"] == 2
    assert (
        owner.put(endpoint, json={"title": "Stale", "content": "Old", "revision": 1}).status_code
        == 409
    )
    assert owner.get(endpoint).json()["content"] == "- [ ] Read\n- [x] Walk"
    assert owner.get(path).json()[0]["title"] == "Sunday"
    assert owner.post(path, json={"title": "  "}).status_code == 422
    assert (
        owner.post(
            f"{API}/channels/{journal['id']}/messages", json={"content": "Hidden"}
        ).status_code
        == 422
    )
    assert (
        owner.post(
            f"{API}/channels/{channel['id']}/journal", json={"title": "Wrong type"}
        ).status_code
        == 422
    )
    assert (
        owner.put(
            f"{API}/channels/{journal['id']}", json={"name": "journal", "kind": "note"}
        ).status_code
        == 422
    )
    assert owner.delete(endpoint, params={"revision": 1}).status_code == 409
    assert owner.delete(endpoint, params={"revision": 2}).status_code == 204


def test_search_and_portable_backup_preserve_threads_and_journals(
    owner: TestClient, channel: dict
) -> None:
    root = owner.post(
        f"{API}/channels/{channel['id']}/messages", json={"content": "Root note"}
    ).json()
    owner.post(f"{API}/messages/{root['id']}/thread", json={"content": "- [x] specialneedle reply"})
    journal = owner.post(
        f"{API}/workspaces/{channel['workspace_id']}/channels",
        json={"name": "pages", "kind": "journal"},
    ).json()
    entry = owner.post(
        f"{API}/channels/{journal['id']}/journal",
        json={"title": "specialneedle journal", "content": "- [ ] Read"},
    ).json()
    results = owner.get(f"{API}/search", params={"q": "specialneedle"})
    assert results.status_code == 200, results.text
    assert {item["kind"] for item in results.json()["items"]} == {"message", "journal"}
    reply = next(item for item in results.json()["items"] if item["kind"] == "message")
    assert reply["thread_root_id"] == root["id"]
    ready, raw = export(owner)
    assert ready["counts"]["journals"] == 1
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
    project_id = channels[0]["id"]
    restored_channels = owner.get(f"{API}/workspaces/{project_id}/channels").json()
    notes_channel = next(item for item in restored_channels if item["kind"] == "note")
    journal_channel = next(item for item in restored_channels if item["kind"] == "journal")
    messages = owner.get(f"{API}/channels/{notes_channel['id']}/messages").json()["items"]
    assert len(messages) == 1 and messages[0]["reply_count"] == 1
    thread = owner.get(f"{API}/messages/{messages[0]['id']}/thread").json()
    assert thread["replies"]["items"][0]["content"] == "- [x] specialneedle reply"
    entries = owner.get(f"{API}/channels/{journal_channel['id']}/journal").json()
    assert entries[0]["id"] != entry["id"]
    assert owner.get(f"{API}/journal/{entries[0]['id']}").json()["content"] == "- [ ] Read"
