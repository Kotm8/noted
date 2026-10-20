from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import NotFoundError
from app.notes.models import Message
from app.workspaces.models import Channel
from app.workspaces.services.workspaces import WorkspaceService
from tests.conftest import API


def test_navigation_crud_and_channel_move(owner: TestClient, channel: dict[str, str]) -> None:
    workspace_id = channel["workspace_id"]
    category = owner.post(
        f"{API}/workspaces/{workspace_id}/categories", json={"name": "Learning"}
    ).json()
    response = owner.put(
        f"{API}/channels/{channel['id']}",
        json={
            "name": "fastapi",
            "category_id": category["id"],
            "position": 2,
        },
    )
    assert response.status_code == 200
    assert response.json()["category_id"] == category["id"]
    assert response.json()["position"] == 2

    response = owner.put(
        f"{API}/workspaces/{workspace_id}", json={"name": "Development", "icon": "D"}
    )
    assert response.status_code == 200
    assert response.json()["name"] == "Development"
    response = owner.put(f"{API}/categories/{category['id']}", json={"name": "Experiments"})
    assert response.status_code == 200
    assert response.json()["name"] == "Experiments"

    assert owner.delete(f"{API}/categories/{category['id']}").status_code == 204
    assert owner.get(f"{API}/workspaces/{workspace_id}/channels").json() == []
    assert owner.delete(f"{API}/workspaces/{workspace_id}").status_code == 204
    assert owner.get(f"{API}/workspaces").json() == []


def test_channel_cannot_use_category_from_another_workspace(
    owner: TestClient, channel: dict[str, str]
) -> None:
    other = owner.post(f"{API}/workspaces", json={"name": "Personal"}).json()
    response = owner.post(
        f"{API}/workspaces/{other['id']}/channels",
        json={
            "name": "invalid",
            "category_id": channel["category_id"],
        },
    )
    assert response.status_code == 422


def test_database_enforces_category_workspace_consistency(
    owner: TestClient, channel: dict[str, str], db: Session
) -> None:
    other = owner.post(f"{API}/workspaces", json={"name": "Personal"}).json()
    db.add(
        Channel(
            workspace_id=UUID(other["id"]),
            category_id=UUID(channel["category_id"]),
            name="invalid",
        )
    )
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


def test_workspace_service_enforces_ownership(channel: dict[str, str], db: Session) -> None:
    with pytest.raises(NotFoundError):
        WorkspaceService(db).get_workspace(UUID(channel["workspace_id"]), uuid4())


def test_message_markdown_is_persisted_edited_and_soft_deleted(
    owner: TestClient, channel: dict[str, str], db: Session
) -> None:
    content = "**A real note**\n\n```python\nprint('Привет')\n```"
    response = owner.post(f"{API}/channels/{channel['id']}/messages", json={"content": content})
    assert response.status_code == 201
    message_id = response.json()["id"]
    stored = db.get(Message, UUID(message_id))
    assert stored is not None and stored.content == content

    response = owner.put(f"{API}/messages/{message_id}", json={"content": "Updated note"})
    assert response.status_code == 200
    assert response.json()["content"] == "Updated note"
    db.expire_all()
    assert (
        db.scalar(select(Message.content).where(Message.id == UUID(message_id))) == "Updated note"
    )

    assert owner.delete(f"{API}/messages/{message_id}").status_code == 204
    assert owner.get(f"{API}/channels/{channel['id']}/messages").json()["items"] == []
    db.expire_all()
    assert db.get(Message, UUID(message_id)).deleted_at is not None
    assert owner.put(f"{API}/messages/{message_id}", json={"content": "Revive"}).status_code == 404


def test_message_cursor_pagination_has_no_duplicates(
    owner: TestClient, channel: dict[str, str]
) -> None:
    created_ids = {
        owner.post(
            f"{API}/channels/{channel['id']}/messages", json={"content": f"Note {index}"}
        ).json()["id"]
        for index in range(5)
    }
    found_ids = []
    cursor = None

    while True:
        parameters = {"limit": "2"}
        if cursor:
            parameters["before"] = cursor
        response = owner.get(f"{API}/channels/{channel['id']}/messages", params=parameters)
        assert response.status_code == 200
        page = response.json()
        assert len(page["items"]) <= 2
        assert [item["created_at"] for item in page["items"]] == sorted(
            item["created_at"] for item in page["items"]
        )
        found_ids.extend(item["id"] for item in page["items"])
        cursor = page["next_cursor"]
        if cursor is None:
            break

    assert len(found_ids) == 5
    assert set(found_ids) == created_ids


@pytest.mark.parametrize(
    "content",
    ["", "   \n\t", "x" * 40001],
    ids=["empty", "whitespace", "too-long"],
)
def test_invalid_messages_are_rejected(
    owner: TestClient, channel: dict[str, str], content: str
) -> None:
    response = owner.post(f"{API}/channels/{channel['id']}/messages", json={"content": content})
    assert response.status_code == 422


def test_invalid_cursor_and_page_size_are_rejected(
    owner: TestClient, channel: dict[str, str]
) -> None:
    path = f"{API}/channels/{channel['id']}/messages"
    assert owner.get(path, params={"before": "invalid"}).status_code == 422
    assert owner.get(path, params={"limit": 0}).status_code == 422
    assert owner.get(path, params={"limit": 201}).status_code == 422


def test_health_checks_validate_schema(client: TestClient, db: Session) -> None:
    assert client.get(f"{API}/health/live").status_code == 200
    assert client.get(f"{API}/health/ready").status_code == 200
    assert client.get(f"{API}/version").json()["schema_revision"] == "0015_wear_os"
    db.execute(text("UPDATE alembic_version SET version_num = 'incompatible'"))
    db.commit()
    assert client.get(f"{API}/health/ready").status_code == 503


def test_unauthenticated_navigation_is_rejected(client: TestClient) -> None:
    assert client.get(f"{API}/workspaces").status_code == 401
    assert client.get(f"{API}/channels/{uuid4()}/messages").status_code == 401
