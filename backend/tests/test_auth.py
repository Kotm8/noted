from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth.models import Installation, LoginSession, User
from app.auth.services.auth import AuthService
from app.core.security import hash_token, utc_now
from tests.conftest import API, TEST_ORIGIN, TEST_PASSWORD, TEST_SECRET


def test_setup_requires_secret_and_can_only_be_claimed_once(
    client: TestClient, db: Session
) -> None:
    data = {"username": "ilya", "password": TEST_PASSWORD, "setup_secret": "incorrect"}
    assert client.post(f"{API}/auth/setup", json=data).status_code == 403

    data["setup_secret"] = TEST_SECRET
    response = client.post(f"{API}/auth/setup", json=data)
    assert response.status_code == 201
    assert response.json()["username"] == "ilya"
    assert "password" not in response.text
    assert client.post(f"{API}/auth/setup", json=data).status_code == 403
    assert client.get(f"{API}/auth/status").json() == {"setup_required": False}
    assert db.scalar(select(func.count()).select_from(User)) == 1

    installation = db.get(Installation, 1)
    assert installation is not None
    assert installation.claimed_at is not None
    assert installation.secret_hash != hash_token(TEST_SECRET)


def test_credentials_and_session_tokens_are_hashed(owner: TestClient, db: Session) -> None:
    user = db.scalar(select(User))
    session = db.scalar(select(LoginSession))
    assert user is not None and session is not None
    assert user.password_hash.startswith("$argon2id$")
    assert user.password_hash != TEST_PASSWORD
    assert session.token_hash == hash_token(owner.cookies["noted_session"])
    assert session.csrf_hash == hash_token(owner.cookies["noted_csrf"])


def test_login_and_logout_revoke_the_old_session(owner: TestClient) -> None:
    old_token = owner.cookies["noted_session"]
    assert owner.post(f"{API}/auth/logout").status_code == 204
    response = owner.get(f"{API}/auth/session", headers={"Cookie": f"noted_session={old_token}"})
    assert response.status_code == 401

    response = owner.post(f"{API}/auth/login", json={"username": "ilya", "password": TEST_PASSWORD})
    assert response.status_code == 200
    session_cookie = next(
        value for value in response.headers.get_list("set-cookie") if "noted_session=" in value
    )
    assert "HttpOnly" in session_cookie
    assert "SameSite=strict" in session_cookie
    assert "Max-Age=" in session_cookie
    assert owner.cookies["noted_session"] != old_token
    assert owner.get(f"{API}/auth/session").status_code == 200


def test_expired_session_is_rejected(owner: TestClient, db: Session) -> None:
    session = db.scalar(select(LoginSession))
    assert session is not None
    session.expires_at = utc_now() - timedelta(seconds=1)
    db.commit()
    assert owner.get(f"{API}/auth/session").status_code == 401


def test_writes_require_csrf_and_trusted_origin(owner: TestClient) -> None:
    response = owner.post(
        f"{API}/workspaces", json={"name": "Unsafe"}, headers={"X-CSRF-Token": ""}
    )
    assert response.status_code == 403
    response = owner.post(
        f"{API}/workspaces",
        json={"name": "Unsafe"},
        headers={"Origin": "https://untrusted.example"},
    )
    assert response.status_code == 403


def test_login_is_rate_limited(owner: TestClient) -> None:
    responses = [
        owner.post(
            f"{API}/auth/login", json={"username": "ilya", "password": "an-incorrect-password"}
        )
        for _ in range(12)
    ]
    assert responses[-1].status_code == 429
    assert responses[-1].headers["Retry-After"] == "60"


def test_validation_errors_do_not_echo_secrets(client: TestClient) -> None:
    response = client.post(f"{API}/auth/login", json={"username": "ilya", "password": "private"})
    assert response.status_code == 422
    assert "private" not in response.text
    assert "input" not in response.text


def test_database_rejects_an_additional_owner(owner: TestClient, db: Session) -> None:
    db.add(User(username="another-owner", password_hash="unusable-test-hash"))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


def test_concurrent_setup_creates_exactly_one_owner(app: FastAPI, db: Session) -> None:
    def claim_owner(username: str) -> int:
        client = TestClient(app, base_url="http://localhost", headers={"Origin": TEST_ORIGIN})
        try:
            response = client.post(
                f"{API}/auth/setup",
                json={
                    "username": username,
                    "password": TEST_PASSWORD,
                    "setup_secret": TEST_SECRET,
                },
            )
            return response.status_code
        finally:
            client.close()

    with ThreadPoolExecutor(max_workers=2) as executor:
        statuses = sorted(executor.map(claim_owner, ["first", "second"]))

    assert statuses == [201, 403]
    assert db.scalar(select(func.count()).select_from(User)) == 1


def test_regenerating_secret_invalidates_the_old_one(client: TestClient, db: Session) -> None:
    replacement = AuthService(db).generate_setup_secret()
    data = {"username": "ilya", "password": TEST_PASSWORD, "setup_secret": TEST_SECRET}
    assert client.post(f"{API}/auth/setup", json=data).status_code == 403
    data["setup_secret"] = replacement
    assert client.post(f"{API}/auth/setup", json=data).status_code == 201
