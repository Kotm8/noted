import base64
import json
import os
import subprocess
import sys
from datetime import datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock
from urllib.parse import parse_qs
from uuid import uuid4

import pytest
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from fastapi.testclient import TestClient
from sqlalchemy import func, select, update

from app.auth.models import LoginSession
from app.core.security import generate_token, utc_now
from app.notifications import firebase
from app.notifications.models import (
    AndroidPairing,
    DevicePresence,
    NotificationDelivery,
    PushSubscription,
)
from app.notifications.worker import dispatch_due
from app.reminders.models import Reminder
from app.schedule.prompts.delivery import dispatch_plan_prompts
from tests.conftest import API, TEST_ORIGIN
from tests.test_reminders import create, subscribe


@pytest.fixture
def firebase_files():
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private = key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
    ).decode()
    return {
        "googleServicesJson": json.dumps(
            {
                "project_info": {"project_id": "noted-fixture", "project_number": "1234567890"},
                "client": [
                    {
                        "client_info": {
                            "mobilesdk_app_id": "1:1234567890:android:abcdef",
                            "android_client_info": {"package_name": "com.noted.android"},
                        },
                        "api_key": [{"current_key": "AIza" + "a" * 35}],
                    }
                ],
            }
        ),
        "serviceAccountJson": json.dumps(
            {
                "type": "service_account",
                "project_id": "noted-fixture",
                "client_email": "test@noted-fixture.iam.gserviceaccount.com",
                "private_key": private,
                "private_key_id": "test-key",
                "token_uri": "https://oauth2.googleapis.com/token",
            }
        ),
    }


def configure(owner, files):
    response = owner.put(f"{API}/notifications/android/config", json=files)
    assert response.status_code == 200, response.text
    assert "private_key" not in response.text


def pair(owner, files):
    configure(owner, files)
    device = str(uuid4())
    response = owner.post(f"{API}/notifications/android/pairings", json={"device_id": device})
    assert response.status_code == 201, response.text
    ticket = response.json()["ticket"]
    prepared = owner.post(f"{API}/notifications/android/prepare", json={"ticket": ticket})
    assert prepared.status_code == 200, prepared.text
    assert "private_key" not in prepared.text
    assert prepared.json()["client"]["project_id"] == "noted-fixture"
    secret = generate_token()
    body = {"ticket": ticket, "token": "phone-token-" + "a" * 64, "secret": secret}
    response = owner.post(f"{API}/notifications/android/complete", json=body)
    assert response.status_code == 204, response.text
    return device, body, {"Authorization": f"Bearer {secret}"}


def test_pairing_is_scoped_idempotent_and_never_exposes_private_credentials(
    owner, db, firebase_files
):
    device, body, headers = pair(owner, firebase_files)
    assert owner.get(f"{API}/notifications/android/status?device_id={device}").json()["subscribed"]
    assert owner.post(f"{API}/notifications/android/complete", json=body).status_code == 204
    assert (
        owner.post(
            f"{API}/notifications/android/complete", json={**body, "secret": generate_token()}
        ).status_code
        == 409
    )
    assert db.scalar(select(func.count()).select_from(PushSubscription)) == 1
    row = db.scalar(select(PushSubscription))
    assert body["secret"] not in json.dumps(row.keys)
    assert body["ticket"] not in db.scalar(select(AndroidPairing.ticket_hash))
    assert (
        owner.put(
            f"{API}/notifications/android/token",
            json={"token": "new-phone-token-" + "b" * 64},
            headers=headers,
        ).status_code
        == 204
    )
    db.expire_all()
    assert "new-phone-token" in db.scalar(select(PushSubscription.endpoint))
    assert owner.delete(f"{API}/notifications/android/device", headers=headers).status_code == 204
    assert not owner.get(f"{API}/notifications/android/status?device_id={device}").json()[
        "subscribed"
    ]
    assert (
        owner.put(
            f"{API}/notifications/android/token",
            json={"token": "another-phone-token-" + "c" * 64},
            headers=headers,
        ).status_code
        == 401
    )


def test_expired_pairings_and_signed_out_devices_are_rejected(owner, db, firebase_files):
    _, _, headers = pair(owner, firebase_files)
    ticket = owner.post(
        f"{API}/notifications/android/pairings", json={"device_id": str(uuid4())}
    ).json()["ticket"]
    db.execute(update(AndroidPairing).values(expires_at=utc_now() - timedelta(seconds=1)))
    db.commit()
    assert (
        owner.post(f"{API}/notifications/android/prepare", json={"ticket": ticket}).status_code
        == 401
    )
    owner.post(f"{API}/auth/logout")
    assert (
        owner.put(
            f"{API}/notifications/android/token",
            json={"token": "new-phone-token-" + "a" * 64},
            headers=headers,
        ).status_code
        == 401
    )


def test_pairing_replaces_browser_delivery_for_the_same_device(owner, db, firebase_files):
    browser = subscribe(owner, "mobile")
    configure(owner, firebase_files)
    ticket = owner.post(
        f"{API}/notifications/android/pairings", json={"device_id": browser["device_id"]}
    ).json()["ticket"]
    result = owner.post(
        f"{API}/notifications/android/complete",
        json={"ticket": ticket, "token": "phone-token-" + "a" * 64, "secret": generate_token()},
    )
    assert result.status_code == 204
    assert db.scalar(select(func.count()).select_from(PushSubscription)) == 1
    assert db.scalar(select(PushSubscription.endpoint)).startswith("fcm:noted-fixture:")


def test_native_actions_need_a_live_device_and_reject_stale_reminders(
    owner, channel, db, firebase_files
):
    _, _, headers = pair(owner, firebase_files)
    message = create(owner, channel)
    action = {"message_id": message["id"], "revision": 1, "action": "snooze", "minutes": 15}
    before = utc_now()
    assert owner.post(f"{API}/notifications/android/actions", json=action).status_code == 401
    assert (
        owner.post(f"{API}/notifications/android/actions", json=action, headers=headers).status_code
        == 204
    )
    db.expire_all()
    reminder = db.scalar(select(Reminder))
    assert before + timedelta(minutes=14) < reminder.due_at < utc_now() + timedelta(minutes=16)
    assert reminder.scheduled_at == datetime.fromisoformat(message["reminder"]["scheduled_at"])
    assert (
        owner.post(f"{API}/notifications/android/actions", json=action, headers=headers).status_code
        == 409
    )
    assert (
        owner.post(
            f"{API}/notifications/android/actions",
            json={**action, "action": "done", "revision": 2},
            headers=headers,
        ).status_code
        == 204
    )
    db.expire_all()
    assert db.scalar(select(Reminder.status)) == "done"


def test_firebase_uses_only_its_own_project_and_preserves_temporary_failures(
    owner, app, firebase_files, monkeypatch
):
    configure(owner, firebase_files)
    monkeypatch.setattr(firebase, "access_token", lambda _: "test-access-token")
    send = Mock(return_value=SimpleNamespace(status_code=200))
    monkeypatch.setattr("requests.post", send)
    storage = app.state.settings.storage_path
    endpoint = "fcm:noted-fixture:phone-token"
    assert (
        firebase.send_firebase(
            endpoint, storage, "https://notes.example.com", '{"title":"Study"}', 60
        )
        == "accepted"
    )
    request = send.call_args
    assert request.args[0] == "https://fcm.googleapis.com/v1/projects/noted-fixture/messages:send"
    body = request.kwargs["json"]["message"]
    assert body["data"]["origin"] == "https://notes.example.com"
    assert body["android"]["priority"] == "HIGH"
    assert "private_key" not in json.dumps(body)
    assert (
        firebase.send_firebase(
            "fcm:other-project:phone-token", storage, "https://notes.example.com", "{}", 60
        )
        == "expired"
    )
    assert send.call_count == 1
    for code, outcome in [
        ("UNREGISTERED", "expired"),
        ("SENDER_ID_MISMATCH", "expired"),
        ("QUOTA_EXCEEDED", "failed"),
    ]:
        send.return_value = SimpleNamespace(
            status_code=404, json=lambda code=code: {"error": {"details": [{"errorCode": code}]}}
        )
        assert (
            firebase.send_firebase(endpoint, storage, "https://notes.example.com", "{}", 60)
            == outcome
        )


def test_due_reminders_use_native_delivery_without_a_browser_vapid_key(
    owner, channel, db, app, firebase_files, monkeypatch
):
    pair(owner, firebase_files)
    message = create(owner, channel)
    db.execute(update(Reminder).values(due_at=utc_now() - timedelta(seconds=1)))
    db.commit()
    send = Mock(return_value="accepted")
    monkeypatch.setattr("app.notifications.delivery.send_firebase", send)
    dispatch_due(db.get_bind(), app.state.settings.app_origin, app.state.settings)
    dispatch_due(db.get_bind(), app.state.settings.app_origin, app.state.settings)
    assert send.call_count == 1
    assert json.loads(send.call_args.args[3])["messageId"] == message["id"]
    assert db.scalar(select(NotificationDelivery.delivered_at)) is not None


def test_desktop_focus_still_suppresses_native_phone_alerts(
    owner, channel, db, app, firebase_files, monkeypatch
):
    pair(owner, firebase_files)
    session = db.scalar(select(LoginSession))
    db.add(
        DevicePresence(
            session_id=session.id,
            device_id=uuid4(),
            kind="desktop",
            focused=True,
            seen_at=utc_now(),
        )
    )
    create(owner, channel)
    db.execute(update(Reminder).values(due_at=utc_now() - timedelta(seconds=1)))
    db.commit()
    send = Mock(return_value="accepted")
    monkeypatch.setattr("app.notifications.delivery.send_firebase", send)
    dispatch_due(db.get_bind(), app.state.settings.app_origin, app.state.settings)
    send.assert_not_called()
    assert db.scalar(select(NotificationDelivery.delivered_at)) is not None


def test_android_delivery_can_be_muted_without_disabling_browser_notifications(
    owner, channel, db, app, firebase_files, monkeypatch
):
    pair(owner, firebase_files)
    response = owner.put(f"{API}/notifications/settings", json={"android_enabled": False})
    assert response.status_code == 200 and response.json()["enabled"] is True
    assert response.json()["android_enabled"] is False
    create(owner, channel)
    db.execute(update(Reminder).values(due_at=utc_now() - timedelta(seconds=1)))
    db.commit()
    send = Mock(return_value="accepted")
    monkeypatch.setattr("app.notifications.delivery.send_firebase", send)
    dispatch_due(db.get_bind(), app.state.settings.app_origin, app.state.settings)
    send.assert_not_called()
    owner.put(f"{API}/notifications/settings", json={"android_enabled": True})
    dispatch_due(db.get_bind(), app.state.settings.app_origin, app.state.settings)
    assert send.call_count == 1


def test_native_plan_notifications_respect_android_setting_and_deliver_only_once(
    owner, db, app, firebase_files, monkeypatch
):
    pair(owner, firebase_files)
    activity = owner.post(f"{API}/time-tracking/activities", json={"name": "Reading"}).json()
    now = utc_now()
    start = min(now.hour * 60 + now.minute, 1438)
    response = owner.post(
        f"{API}/schedule/plans",
        json={
            "activity_id": activity["id"],
            "title": "Read a chapter",
            "date": now.date().isoformat(),
            "start_minute": start,
            "end_minute": start + 1,
            "timezone": "UTC",
            "notification_minutes": 0,
        },
    )
    assert response.status_code == 201, response.text
    send = Mock(return_value="accepted")
    monkeypatch.setattr("app.notifications.delivery.send_firebase", send)
    owner.put(f"{API}/notifications/settings", json={"android_enabled": False})
    dispatch_plan_prompts(db.get_bind(), app.state.settings.app_origin, app.state.settings)
    send.assert_not_called()
    owner.put(f"{API}/notifications/settings", json={"android_enabled": True})
    dispatch_plan_prompts(db.get_bind(), app.state.settings.app_origin, app.state.settings)
    dispatch_plan_prompts(db.get_bind(), app.state.settings.app_origin, app.state.settings)
    assert send.call_count == 1
    payload = json.loads(send.call_args.args[3])
    assert payload["kind"] == "plan" and payload["body"] == "Read a chapter"


def test_firebase_credentials_sign_scoped_oauth_requests_and_cache_tokens(
    owner, app, firebase_files, monkeypatch
):
    configure(owner, firebase_files)
    configuration = firebase.load_configuration(app.state.settings.storage_path)
    transport = Mock(
        return_value=SimpleNamespace(
            status=200,
            data=b'{"access_token":"fixture-access-token","expires_in":3600,"token_type":"Bearer"}',
            headers={},
        )
    )
    monkeypatch.setattr("google.auth.transport.requests.Request", lambda: transport)
    monkeypatch.setattr(firebase, "_credentials", None)
    assert firebase.access_token(configuration) == "fixture-access-token"
    assert firebase.access_token(configuration) == "fixture-access-token"
    assert transport.call_count == 1
    values = transport.call_args.kwargs
    encoded = parse_qs(values["body"].decode())["assertion"][0]
    first, second, signature = encoded.split(".")

    def decode(value):
        return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))

    claims = json.loads(decode(second))
    assert claims["scope"] == "https://www.googleapis.com/auth/firebase.messaging"
    assert claims["aud"] == "https://oauth2.googleapis.com/token"
    key = serialization.load_pem_private_key(
        configuration.account["private_key"].encode(), password=None
    )
    key.public_key().verify(
        decode(signature), f"{first}.{second}".encode(), padding.PKCS1v15(), hashes.SHA256()
    )


def test_invalid_firebase_json_never_replaces_a_working_configuration(owner, app, firebase_files):
    configure(owner, firebase_files)
    path = firebase.configuration_path(app.state.settings.storage_path)
    original = path.read_bytes()
    for invalid in [
        "not-json-private-secret",
        firebase_files["serviceAccountJson"].replace("noted-fixture", "other-project"),
    ]:
        response = owner.put(
            f"{API}/notifications/android/config",
            json={**firebase_files, "serviceAccountJson": invalid},
        )
        assert response.status_code == 422
        assert "not-json-private-secret" not in response.text
        assert path.read_bytes() == original


def test_native_notification_token_survives_network_changes(owner, app, firebase_files):
    _, _, authorization = pair(owner, firebase_files)
    for address in ("198.51.100.10", "203.0.113.20", "2001:db8::42"):
        with TestClient(
            app,
            base_url="http://localhost",
            client=(address, 50000),
            headers={"Origin": TEST_ORIGIN, **authorization},
        ) as phone:
            assert phone.get(f"{API}/notifications/android/activities").status_code == 200
            assert (
                phone.get(
                    f"{API}/notifications/android/activities", headers={"Authorization": ""}
                ).status_code
                == 401
            )


def test_installer_configuration_script_validates_key_and_writes_only_private_file(
    firebase_files, tmp_path
):
    configuration = firebase.parse_configuration(firebase.FirebaseInput(**firebase_files))
    data = {
        "client": configuration.client.model_dump(),
        "service_account": configuration.account,
    }
    private = configuration.account["private_key"]
    script = (
        "import sys; sys.path.insert(0, '../updater'); "
        "from noted_updater.android_notifications import CONFIGURE_SCRIPT; exec(CONFIGURE_SCRIPT)"
    )

    def configure_script():
        return subprocess.run(
            [sys.executable, "-c", script],
            input=json.dumps(data),
            text=True,
            capture_output=True,
            timeout=30,
            cwd=Path(__file__).resolve().parents[1],
            env={
                **os.environ,
                "NOTED_DATABASE_URL": "postgresql+psycopg://noted@localhost/noted",
                "NOTED_STORAGE_PATH": str(tmp_path),
            },
        )

    data["service_account"]["private_key"] = "fixture-only-invalid-key"
    invalid = configure_script()
    assert invalid.returncode != 0
    path = tmp_path / ".server/firebase.json"
    assert not path.exists()
    assert "fixture-only" not in invalid.stderr
    data["service_account"]["private_key"] = private
    result = configure_script()
    assert result.returncode == 0, result.stderr
    assert json.loads(path.read_text())["service_account"]["private_key"] == private
    assert result.stdout == "" and private not in result.stderr
    assert list(path.parent.iterdir()) == [path]
    if os.name != "nt":
        assert path.stat().st_mode & 0o777 == 0o600
