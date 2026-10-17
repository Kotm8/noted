import json
from datetime import timedelta
from unittest.mock import Mock

from pywebpush import WebPushException
from requests import Response
from sqlalchemy import func, select, update

from app.auth.models import LoginSession
from app.core.security import utc_now
from app.notes.models import Message
from app.notifications.models import PushSubscription
from tests.conftest import API, TEST_PASSWORD
from tests.test_reminders import subscribe


def test_phone_test_requires_auth_csrf_and_a_subscribed_phone(client, owner, monkeypatch):
    send = Mock()
    monkeypatch.setattr("pywebpush.webpush", send)
    assert owner.post(f"{API}/notifications/test").status_code == 409
    subscribe(owner, "mobile")
    assert (
        owner.post(f"{API}/notifications/test", headers={"X-CSRF-Token": "wrong"}).status_code
        == 403
    )
    owner.post(f"{API}/auth/logout")
    assert client.post(f"{API}/notifications/test").status_code == 401
    send.assert_not_called()


def test_phone_test_ignores_focus_and_excludes_desktops_and_creates_no_messages(
    owner, db, monkeypatch
):
    desktop = subscribe(owner)
    phone = subscribe(owner, "mobile")
    owner.post(
        f"{API}/notifications/presence",
        json={
            "device_id": desktop["device_id"],
            "kind": "desktop",
            "focused": True,
        },
    )
    send = Mock()
    monkeypatch.setattr("pywebpush.webpush", send)
    response = owner.post(f"{API}/notifications/test")
    assert response.json() == {"accepted": 1, "expired": 0, "failed": 0}
    assert send.call_count == 1
    assert send.call_args.kwargs["subscription_info"]["endpoint"] == phone["endpoint"]
    payload = json.loads(send.call_args.kwargs["data"])
    assert payload["kind"] == "diagnostic"
    assert payload["url"] == "/"
    assert "messageId" not in payload
    assert db.scalar(select(func.count()).select_from(Message)) == 0


def test_phone_test_skips_expired_and_revoked_sessions(owner, db, monkeypatch):
    subscribe(owner, "mobile")
    db.execute(update(LoginSession).values(expires_at=utc_now() - timedelta(seconds=1)))
    db.commit()
    response = owner.post(f"{API}/auth/login", json={"username": "ilya", "password": TEST_PASSWORD})
    assert response.status_code == 200
    owner.headers["X-CSRF-Token"] = owner.cookies["noted_csrf"]
    send = Mock()
    monkeypatch.setattr("pywebpush.webpush", send)
    assert owner.post(f"{API}/notifications/test").status_code == 409
    db.execute(
        update(LoginSession)
        .where(LoginSession.expires_at < utc_now())
        .values(
            expires_at=utc_now() + timedelta(hours=1),
            revoked_at=utc_now(),
        )
    )
    db.commit()
    assert owner.post(f"{API}/notifications/test").status_code == 409
    send.assert_not_called()


def test_phone_test_reports_provider_failures_and_removes_expired_subscriptions(
    owner, db, monkeypatch
):
    subscribe(owner, "mobile")
    subscribe(owner, "mobile")
    response = Response()
    response.status_code = 410
    send = Mock(
        side_effect=[
            WebPushException("expired", response=response),
            WebPushException("unavailable"),
        ]
    )
    monkeypatch.setattr("pywebpush.webpush", send)
    result = owner.post(f"{API}/notifications/test")
    assert result.json() == {"accepted": 0, "expired": 1, "failed": 1}
    assert db.scalar(select(func.count()).select_from(PushSubscription)) == 1
