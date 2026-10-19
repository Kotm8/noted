from datetime import timedelta
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.models import LoginSession
from app.auth.services.sessions import SessionService
from app.core.errors import NotFoundError
from app.core.security import hash_token, utc_now
from tests.conftest import API, TEST_ORIGIN, TEST_PASSWORD


def test_list_and_revoke_individual_sessions(owner: TestClient, app: FastAPI, db: Session) -> None:
    with TestClient(app, base_url="http://localhost", headers={"Origin": TEST_ORIGIN}) as other:
        response = other.post(
            f"{API}/auth/login",
            json={"username": "ilya", "password": TEST_PASSWORD},
            headers={"User-Agent": "Firefox/140.0 Linux"},
        )
        assert response.status_code == 200
        other.headers["X-CSRF-Token"] = other.cookies["noted_csrf"]
        sessions = owner.get(f"{API}/auth/sessions").json()
        assert len(sessions) == 2
        assert sum(session["is_current"] for session in sessions) == 1
        remote = next(session for session in sessions if not session["is_current"])
        assert remote["user_agent"] == "Firefox/140.0 Linux"
        assert remote["created_at"] and remote["last_seen_at"]
        assert not {"token_hash", "csrf_hash", "token", "csrf_token"} & remote.keys()
        path = f"{API}/auth/sessions/{remote['id']}"
        assert owner.delete(path, headers={"X-CSRF-Token": ""}).status_code == 403
        assert owner.delete(path).status_code == 204
        assert other.get(f"{API}/auth/session").status_code == 401
        assert owner.get(f"{API}/auth/session").status_code == 200
        assert len(owner.get(f"{API}/auth/sessions").json()) == 1
        assert owner.delete(path).status_code == 404
        assert owner.delete(f"{API}/auth/sessions/{uuid4()}").status_code == 404
    active = db.scalar(select(LoginSession).where(LoginSession.revoked_at.is_(None)))
    assert active is not None
    with pytest.raises(NotFoundError):
        SessionService(db).revoke_by_id(active.id, uuid4())


def test_current_session_can_be_revoked_and_cookie_is_cleared(owner: TestClient) -> None:
    current = owner.get(f"{API}/auth/sessions").json()[0]
    response = owner.delete(f"{API}/auth/sessions/{current['id']}")
    assert response.status_code == 204
    assert not owner.cookies.get("noted_session")
    assert owner.get(f"{API}/auth/session").status_code == 401


def test_expired_sessions_are_hidden_and_legacy_activity_is_updated(
    owner: TestClient, db: Session
) -> None:
    session = db.scalar(select(LoginSession))
    assert session is not None
    session.created_at = None
    session.last_seen_at = None
    session.user_agent = None
    db.add(
        LoginSession(
            user_id=session.user_id,
            token_hash=hash_token("expired-session"),
            csrf_hash=hash_token("expired-csrf"),
            expires_at=utc_now() - timedelta(seconds=1),
        )
    )
    db.commit()
    sessions = owner.get(f"{API}/auth/sessions").json()
    assert len(sessions) == 1
    assert sessions[0]["created_at"] is None
    assert sessions[0]["user_agent"] is None
    assert sessions[0]["last_seen_at"] is not None


def test_session_management_requires_authentication(client: TestClient) -> None:
    assert client.get(f"{API}/auth/sessions").status_code == 401
    assert client.delete(f"{API}/auth/sessions/{uuid4()}").status_code == 401


def test_session_survives_vpn_and_network_changes_but_still_requires_its_token(
    owner: TestClient, app: FastAPI
) -> None:
    with TestClient(
        app,
        base_url="http://localhost",
        headers={"Origin": TEST_ORIGIN},
        client=("198.51.100.10", 50000),
    ) as vpn:
        response = vpn.post(
            f"{API}/auth/login",
            json={"username": "ilya", "password": TEST_PASSWORD},
        )
        assert response.status_code == 200
        cookies = dict(vpn.cookies)
        initial = vpn.get(f"{API}/auth/session").json()

    with TestClient(
        app,
        base_url="http://localhost",
        headers={"Origin": TEST_ORIGIN, "X-CSRF-Token": cookies["noted_csrf"]},
        cookies=cookies,
        client=("2001:db8::42", 51000),
    ) as mobile:
        response = mobile.get(f"{API}/auth/session")
        assert response.status_code == 200 and response.json() == initial
        created = mobile.post(f"{API}/workspaces", json={"name": "VPN switched off"})
        assert created.status_code == 201, created.text
        assert (
            mobile.delete(
                f"{API}/workspaces/{created.json()['id']}", headers={"X-CSRF-Token": ""}
            ).status_code
            == 403
        )
        sessions = owner.get(f"{API}/auth/sessions").json()
        remote = next(session for session in sessions if not session["is_current"])
        assert owner.delete(f"{API}/auth/sessions/{remote['id']}").status_code == 204
        assert mobile.get(f"{API}/auth/session").status_code == 401

    with TestClient(
        app, base_url="http://localhost", client=("198.51.100.10", 52000)
    ) as without_token:
        assert without_token.get(f"{API}/auth/session").status_code == 401
