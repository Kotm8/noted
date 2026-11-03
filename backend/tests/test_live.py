from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session
from starlette.websockets import WebSocketDisconnect

from app.auth.repository import SessionRepository
from app.core.security import utc_now
from app.live.hub import LiveHub, Peer
from app.live.topics import LiveEvent
from app.notes.models import Message
from tests.conftest import API, TEST_ORIGIN


def socket(owner: TestClient):
    return owner.websocket_connect(f"ws://localhost{API}/live", headers={"origin": TEST_ORIGIN})


@pytest.mark.parametrize("origin", [None, "https://untrusted.example"])
def test_live_rejects_missing_or_foreign_origin(owner: TestClient, origin: str | None) -> None:
    headers = dict(owner.headers)
    headers.pop("origin", None)
    owner.headers.pop("origin", None)
    if origin is not None:
        headers["origin"] = origin
    with (
        pytest.raises(WebSocketDisconnect) as error,
        owner.websocket_connect(f"ws://localhost{API}/live", headers=headers),
    ):
        pass
    assert error.value.code == 1008


def test_live_requires_a_session(client: TestClient) -> None:
    with pytest.raises(WebSocketDisconnect) as error, socket(client):
        pass
    assert error.value.code == 1008


def test_live_rejects_revoked_sessions(owner: TestClient) -> None:
    owner.post(f"{API}/auth/logout")
    with pytest.raises(WebSocketDisconnect) as error, socket(owner):
        pass
    assert error.value.code == 1008


def test_committed_message_reaches_the_owners_socket(
    owner: TestClient, channel: dict[str, str]
) -> None:
    with socket(owner) as live:
        assert live.receive_json()["type"] == "hello"
        assert (
            owner.post(
                f"{API}/channels/{channel['id']}/messages", json={"content": "Live message"}
            ).status_code
            == 201
        )
        event = live.receive_json()
        assert event == {
            "topic": "notes",
            "user": owner.get(f"{API}/auth/session").json()["id"],
            "channel": channel["id"],
        }
        assert "content" not in event


def test_rollback_and_savepoint_changes_never_announce_and_commit_is_deduped(
    owner: TestClient, channel: dict[str, str], engine: Engine
) -> None:
    user = owner.get(f"{API}/auth/session").json()["id"]
    other = owner.post(
        f"{API}/workspaces/{channel['workspace_id']}/channels", json={"name": "barrier"}
    ).json()["id"]
    with socket(owner) as live, Session(engine) as db:
        assert live.receive_json()["type"] == "hello"
        db.add(Message(channel_id=channel["id"], author_id=user, content="Rolled back"))
        db.flush()
        db.rollback()
        db.add(Message(channel_id=other, author_id=user, content="Committed"))
        db.commit()
        assert live.receive_json()["channel"] == other
        db.add(Message(channel_id=channel["id"], author_id=user, content="First"))
        db.flush()
        with db.begin_nested() as nested:
            db.add(Message(channel_id=other, author_id=user, content="Savepoint rollback"))
            db.flush()
            nested.rollback()
        db.add(Message(channel_id=channel["id"], author_id=user, content="Second"))
        db.commit()
        db.add(Message(channel_id=other, author_id=user, content="Barrier"))
        db.commit()
        assert live.receive_json()["channel"] == channel["id"]
        assert live.receive_json()["channel"] == other


def test_core_session_revocation_closes_the_socket(owner: TestClient, engine: Engine) -> None:
    current = owner.get(f"{API}/auth/sessions").json()[0]
    user = owner.get(f"{API}/auth/session").json()["id"]
    with socket(owner) as live:
        assert live.receive_json()["type"] == "hello"
        with Session(engine) as db:
            from uuid import UUID

            assert SessionRepository(db).revoke_for_owner(
                UUID(current["id"]), UUID(user), utc_now()
            )
            db.commit()
        with pytest.raises(WebSocketDisconnect) as error:
            live.receive_json()
        assert error.value.code == 1000


def test_maintenance_refuses_new_sockets(owner: TestClient, tmp_path) -> None:
    path = tmp_path / "maintenance"
    path.touch()
    owner.app.state.settings.maintenance_path = path
    with pytest.raises(WebSocketDisconnect) as error, socket(owner):
        pass
    assert error.value.code == 1013


def test_hub_routes_by_user_and_drops_slow_sockets(app) -> None:
    hub = LiveHub(app.state.settings, app.state.engine)
    user = uuid4()
    target = Peer(user=user, session=uuid4(), expires=utc_now())
    unrelated = Peer(user=uuid4(), session=uuid4(), expires=utc_now())
    hub.peers.update((target, unrelated))
    event = LiveEvent(topic="tracker", user=user)
    hub.dispatch(event)
    assert target.queue.get_nowait()["topic"] == "tracker"
    assert unrelated.queue.empty()
    for _ in range(65):
        hub.dispatch(event)
    assert target not in hub.peers
    assert target.queue.get_nowait() == 1013
    assert unrelated in hub.peers
