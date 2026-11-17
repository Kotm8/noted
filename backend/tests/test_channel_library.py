from uuid import UUID, uuid4

from sqlalchemy import select

from app.auth.models import User
from app.core.security import utc_now
from app.notes.models import Message
from tests.conftest import API


def test_library_includes_threads_and_hides_deleted_sources(owner, channel, db):
    root = owner.post(
        f"{API}/channels/{channel['id']}/messages",
        json={"content": "Read https://example.com/guide"},
    ).json()
    user = db.scalar(select(User))
    reply = Message(
        channel_id=UUID(channel["id"]),
        author_id=user.id,
        thread_root_id=UUID(root["id"]),
        content="https://example.com/reply",
    )
    db.add(reply)
    db.commit()
    path = f"{API}/channels/{channel['id']}/library"
    response = owner.get(path)
    assert response.status_code == 200, response.text
    items = response.json()["items"]
    assert len(items) == 2
    assert {item["links"][0] for item in items} == {
        "https://example.com/guide",
        "https://example.com/reply",
    }
    assert (
        next(item for item in items if item["id"] == str(reply.id))["thread_root_id"] == root["id"]
    )
    db.get(Message, UUID(root["id"])).deleted_at = utc_now()
    db.commit()
    assert owner.get(path).json()["items"] == []
    assert owner.get(f"{API}/channels/{uuid4()}/library").status_code == 404


def test_library_files_are_scoped_to_their_channel(owner, channel):
    created = owner.post(
        f"{API}/channels/{channel['id']}/messages/with-files",
        data={"content": "A file"},
        files=[("files", ("kept.txt", b"kept", "text/plain"))],
    )
    assert created.status_code == 201, created.text
    item = owner.get(f"{API}/channels/{channel['id']}/library").json()["items"][0]
    assert item["attachments"][0]["original_filename"] == "kept.txt"
    assert owner.get(item["attachments"][0]["download_url"]).content == b"kept"
