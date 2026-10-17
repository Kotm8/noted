from fastapi import FastAPI
from fastapi.testclient import TestClient

from tests.conftest import API, TEST_ORIGIN, TEST_PASSWORD


def test_search_filters_literals_and_deleted_notes(
    owner: TestClient, channel: dict[str, str]
) -> None:
    path = f"{API}/channels/{channel['id']}/messages"
    notes = [
        owner.post(path, json={"content": content}).json()
        for content in (
            "Python reference",
            "PYTHON details",
            "Русские заметки",
            "literal 50%_complete",
        )
    ]
    search = f"{API}/search"
    result = owner.get(search, params={"q": "python", "limit": 1}).json()
    assert result["total"] == 2
    assert result["items"][0]["id"] == notes[1]["id"]
    assert (
        owner.get(search, params={"q": "python", "offset": 1}).json()["items"][0]["id"]
        == notes[0]["id"]
    )
    assert owner.get(search, params={"q": "РУССКИЕ"}).json()["total"] == 1
    assert owner.get(search, params={"q": "%_"}).json()["total"] == 1
    other = owner.post(f"{API}/workspaces", json={"name": "Other"}).json()
    assert (
        owner.get(search, params={"q": "python", "workspace_id": other["id"]}).json()["total"] == 0
    )
    assert (
        owner.get(
            search, params={"q": "python", "channel_id": channel["id"], "sort": "oldest"}
        ).json()["items"][0]["id"]
        == notes[0]["id"]
    )
    owner.delete(f"{API}/messages/{notes[0]['id']}")
    assert owner.get(search, params={"q": "python"}).json()["total"] == 1
    assert owner.get(search, params={"q": "p"}).status_code == 422


def test_search_result_context_can_page_in_both_directions(
    owner: TestClient, channel: dict[str, str]
) -> None:
    path = f"{API}/channels/{channel['id']}/messages"
    notes = [owner.post(path, json={"content": f"Note {index}"}).json() for index in range(7)]
    context = owner.get(path, params={"around": notes[3]["id"], "limit": 2}).json()
    assert [note["id"] for note in context["items"]] == [notes[2]["id"], notes[3]["id"]]
    older = owner.get(path, params={"before": context["next_cursor"], "limit": 2}).json()
    assert [note["id"] for note in older["items"]] == [notes[0]["id"], notes[1]["id"]]
    newer = owner.get(path, params={"after": context["newer_cursor"], "limit": 2}).json()
    assert [note["id"] for note in newer["items"]] == [notes[4]["id"], notes[5]["id"]]
    latest = owner.get(path, params={"after": newer["newer_cursor"], "limit": 2}).json()
    assert [note["id"] for note in latest["items"]] == [notes[6]["id"]]
    assert latest["newer_cursor"] is None
    assert (
        owner.get(
            path, params={"around": notes[3]["id"], "before": context["next_cursor"]}
        ).status_code
        == 422
    )


def test_owner_password_change_rotates_sessions(owner: TestClient, app: FastAPI) -> None:
    details = owner.get(f"{API}/settings/server")
    assert details.status_code == 200
    assert details.json()["access_mode"] == "owner_only"
    assert details.json()["database_ready"] is True
    with TestClient(app, base_url="http://localhost", headers={"Origin": TEST_ORIGIN}) as other:
        other.post(f"{API}/auth/login", json={"username": "ilya", "password": TEST_PASSWORD})
        assert other.get(f"{API}/auth/session").status_code == 200
        path = f"{API}/settings/password"
        assert (
            owner.put(
                path, json={"current_password": "wrong", "new_password": "a-new-password-for-tests"}
            ).status_code
            == 401
        )
        assert owner.get(f"{API}/auth/session").status_code == 200
        response = owner.put(
            path,
            json={"current_password": TEST_PASSWORD, "new_password": "a-new-password-for-tests"},
        )
        assert response.status_code == 200
        assert other.get(f"{API}/auth/session").status_code == 401
        assert owner.get(f"{API}/auth/session").status_code == 200
        owner.headers["X-CSRF-Token"] = owner.cookies["noted_csrf"]
        assert owner.post(f"{API}/auth/logout").status_code == 204
        assert (
            other.post(
                f"{API}/auth/login", json={"username": "ilya", "password": TEST_PASSWORD}
            ).status_code
            == 401
        )
        assert (
            other.post(
                f"{API}/auth/login",
                json={"username": "ilya", "password": "a-new-password-for-tests"},
            ).status_code
            == 200
        )
