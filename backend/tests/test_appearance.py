from concurrent.futures import ThreadPoolExecutor

from fastapi import FastAPI
from fastapi.testclient import TestClient

from tests.conftest import API, TEST_ORIGIN, TEST_PASSWORD


def test_appearance_is_shared_between_sessions_and_partial_changes_merge(
    owner: TestClient, app: FastAPI
) -> None:
    path = f"{API}/settings/appearance"
    assert owner.get(path).json() is None
    initialized = owner.put(f"{path}?initialize=true", json={"accent": "#abcdef"})
    assert initialized.status_code == 200
    assert initialized.json()["messageLayout"] == "minute"
    with TestClient(app, base_url="http://localhost", headers={"Origin": TEST_ORIGIN}) as other:
        assert (
            other.post(
                f"{API}/auth/login", json={"username": "ilya", "password": TEST_PASSWORD}
            ).status_code
            == 200
        )
        other.headers["X-CSRF-Token"] = other.cookies["noted_csrf"]
        assert other.get(path).json()["accent"] == "#abcdef"
        assert other.put(path, json={"messageLayout": "connected"}).status_code == 200
        assert owner.put(path, json={"textSize": 17}).status_code == 200
        saved = other.get(path).json()
        assert saved["messageLayout"] == "connected"
        assert saved["textSize"] == 17
        assert saved["accent"] == "#abcdef"
        assert other.put(f"{path}?initialize=true", json={"accent": "#000000"}).json() == saved


def test_appearance_validation_and_access(owner: TestClient, app: FastAPI) -> None:
    path = f"{API}/settings/appearance"
    for invalid in (
        {"accent": "url(javascript:bad)"},
        {"messageLayout": "unknown"},
        {"zoom": 1000},
        {"textSize": 1},
        {"textSize": True},
        {"password": "no"},
    ):
        assert owner.put(path, json=invalid).status_code == 422
    assert owner.put(path, json={}, headers={"X-CSRF-Token": ""}).status_code == 403
    with TestClient(app, base_url="http://localhost", headers={"Origin": TEST_ORIGIN}) as anonymous:
        assert anonymous.get(path).status_code == 401
        assert anonymous.put(path, json={}).status_code == 401


def test_concurrent_appearance_changes_do_not_overwrite_other_fields(
    owner: TestClient, app: FastAPI
) -> None:
    def save(changes: dict[str, str]) -> int:
        with TestClient(
            app, base_url="http://localhost", headers={"Origin": TEST_ORIGIN}
        ) as device:
            device.cookies.update(owner.cookies)
            device.headers["X-CSRF-Token"] = owner.cookies["noted_csrf"]
            return device.put(f"{API}/settings/appearance", json=changes).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(save, [{"accent": "#abcdef"}, {"messageLayout": "connected"}]))
    assert results == [200, 200]
    saved = owner.get(f"{API}/settings/appearance").json()
    assert saved["accent"] == "#abcdef"
    assert saved["messageLayout"] == "connected"
