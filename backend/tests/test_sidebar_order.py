from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.errors import NotFoundError
from app.workspaces.schemas import SidebarMove
from app.workspaces.services.ordering import SidebarOrderService
from tests.conftest import API


def test_channel_order_and_category_moves_preserve_content(
    owner: TestClient, channel: dict[str, str]
) -> None:
    workspace_id = channel["workspace_id"]
    path = f"{API}/workspaces/{workspace_id}"
    second = owner.post(f"{path}/channels", json={"name": "second"}).json()
    third = owner.post(f"{path}/channels", json={"name": "third"}).json()
    message = owner.post(
        f"{API}/channels/{third['id']}/messages", json={"content": "Keep this note"}
    ).json()
    moved = owner.put(
        f"{path}/order",
        json={
            "kind": "channel",
            "id": third["id"],
            "before_id": second["id"],
        },
    )
    assert moved.status_code == 200
    assert [item["id"] for item in moved.json()["channels"] if not item["category_id"]] == [
        third["id"],
        second["id"],
    ]
    assert (
        owner.put(
            f"{path}/order",
            json={
                "kind": "channel",
                "id": third["id"],
                "category_id": channel["category_id"],
                "before_id": channel["id"],
            },
        ).status_code
        == 200
    )
    stored = owner.get(f"{path}/channels").json()
    assert [item["id"] for item in stored if item["category_id"] == channel["category_id"]] == [
        third["id"],
        channel["id"],
    ]
    assert (
        owner.get(f"{API}/channels/{third['id']}/messages").json()["items"][0]["id"]
        == message["id"]
    )
    assert (
        owner.put(
            f"{path}/order",
            json={
                "kind": "channel",
                "id": third["id"],
                "category_id": None,
            },
        ).status_code
        == 200
    )
    assert [
        item["id"] for item in owner.get(f"{path}/channels").json() if not item["category_id"]
    ] == [
        second["id"],
        third["id"],
    ]


def test_category_order_keeps_its_channels(owner: TestClient, channel: dict[str, str]) -> None:
    path = f"{API}/workspaces/{channel['workspace_id']}"
    second = owner.post(f"{path}/categories", json={"name": "Second", "position": 1}).json()
    third = owner.post(f"{path}/categories", json={"name": "Third", "position": 2}).json()
    response = owner.put(
        f"{path}/order",
        json={
            "kind": "category",
            "id": third["id"],
            "before_id": channel["category_id"],
        },
    )
    assert response.status_code == 200
    assert [item["id"] for item in owner.get(f"{path}/categories").json()] == [
        third["id"],
        channel["category_id"],
        second["id"],
    ]
    assert owner.get(f"{path}/channels").json()[0]["category_id"] == channel["category_id"]


def test_invalid_destination_does_not_partially_reorder(
    owner: TestClient, channel: dict[str, str]
) -> None:
    path = f"{API}/workspaces/{channel['workspace_id']}"
    other = owner.post(f"{path}/channels", json={"name": "other"}).json()
    before = owner.get(f"{path}/channels").json()
    response = owner.put(
        f"{path}/order",
        json={
            "kind": "channel",
            "id": channel["id"],
            "category_id": None,
            "before_id": str(uuid4()),
        },
    )
    assert response.status_code == 422
    assert owner.get(f"{path}/channels").json() == before
    response = owner.put(
        f"{path}/order",
        json={
            "kind": "channel",
            "id": other["id"],
            "category_id": None,
            "before_id": channel["id"],
        },
    )
    assert response.status_code == 422
    assert owner.get(f"{path}/channels").json() == before


def test_order_cannot_move_items_between_workspaces(
    owner: TestClient, channel: dict[str, str]
) -> None:
    other = owner.post(f"{API}/workspaces", json={"name": "Other"}).json()
    category = owner.post(
        f"{API}/workspaces/{other['id']}/categories", json={"name": "Foreign"}
    ).json()
    path = f"{API}/workspaces/{channel['workspace_id']}/order"
    assert (
        owner.put(
            path,
            json={
                "kind": "channel",
                "id": channel["id"],
                "category_id": category["id"],
            },
        ).status_code
        == 422
    )
    assert (
        owner.put(
            path,
            json={
                "kind": "category",
                "id": category["id"],
            },
        ).status_code
        == 404
    )
    assert (
        owner.put(
            f"{API}/workspaces/{other['id']}/order",
            json={
                "kind": "channel",
                "id": channel["id"],
            },
        ).status_code
        == 404
    )


def test_order_requires_workspace_ownership(channel: dict[str, str], db: Session) -> None:
    with pytest.raises(NotFoundError):
        SidebarOrderService(db).move(
            UUID(channel["workspace_id"]),
            uuid4(),
            SidebarMove(kind="channel", id=UUID(channel["id"])),
        )
