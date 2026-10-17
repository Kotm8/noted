import base64
import io
import json
import zipfile
from datetime import UTC, datetime, timedelta
from unittest.mock import Mock
from uuid import UUID, uuid4

import pytest
from sqlalchemy import func, select, update

from app.core.security import utc_now
from app.notes.models import Message
from app.notifications.models import DevicePresence, NotificationDelivery, PushSubscription
from app.notifications.worker import dispatch_due
from app.reminders.models import Reminder
from app.reminders.service import next_occurrence
from tests.conftest import API
from tests.test_backups import export, upload


def schedule(**values):
    return {
        "due_at": (utc_now() + timedelta(hours=1)).isoformat(),
        "timezone": "Europe/Moscow",
        "repeat": "none",
        **values,
    }


def create(owner, channel, **values):
    response = owner.post(
        f"{API}/channels/{channel['id']}/messages",
        json={"content": "Stretch and take a break", "reminder": schedule(**values)},
    )
    assert response.status_code == 201, response.text
    return response.json()


def reminder_channel(owner, channel):
    response = owner.put(
        f"{API}/channels/{channel['id']}", json={"name": "reminders", "kind": "reminder"}
    )
    assert response.status_code == 200
    return response.json()


def subscribe(owner, kind="desktop"):
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec

    public = (
        ec.generate_private_key(ec.SECP256R1())
        .public_key()
        .public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    )

    def encode(data):
        return base64.urlsafe_b64encode(data).rstrip(b"=").decode()

    body = {
        "device_id": str(uuid4()),
        "kind": kind,
        "endpoint": f"https://fcm.googleapis.com/fcm/send/{uuid4()}",
        "keys": {"p256dh": encode(public), "auth": encode(b"a" * 16)},
    }
    response = owner.post(f"{API}/notifications/subscriptions", json=body)
    assert response.status_code == 204, response.text
    return body


def test_reminder_channel_requires_time_atomically(owner, channel, db):
    channel = reminder_channel(owner, channel)
    renamed = owner.put(f"{API}/channels/{channel['id']}", json={"name": "reminders-renamed"})
    assert renamed.json()["kind"] == "reminder"
    response = owner.post(f"{API}/channels/{channel['id']}/messages", json={"content": "No time"})
    assert response.status_code == 422
    response = owner.post(
        f"{API}/channels/{channel['id']}/messages/with-files",
        data={"content": "No time"},
        files={"files": ("test.txt", b"test")},
    )
    assert response.status_code == 422
    assert db.scalar(select(func.count()).select_from(Message)) == 0
    message = create(owner, channel)
    assert message["reminder"]["status"] == "active"
    assert (
        owner.get(f"{API}/channels/{channel['id']}/messages").json()["items"][0]["reminder"]
        == message["reminder"]
    )


@pytest.mark.parametrize(
    "values",
    [
        {"due_at": "2020-01-01T00:00:00Z"},
        {"due_at": "2030-01-01T00:00:00"},
        {"timezone": "Unknown/Timezone"},
    ],
)
def test_invalid_schedule_creates_no_message(owner, channel, db, values):
    response = owner.post(
        f"{API}/channels/{channel['id']}/messages",
        json={"content": "Invalid", "reminder": schedule(**values)},
    )
    assert response.status_code == 422
    assert db.scalar(select(func.count()).select_from(Message)) == 0


def test_files_and_reminder_commit_together(owner, channel):
    channel = reminder_channel(owner, channel)
    response = owner.post(
        f"{API}/channels/{channel['id']}/messages/with-files",
        data={"content": "File reminder", "reminder": json.dumps(schedule())},
        files={"files": ("test.txt", b"kept")},
    )
    assert response.status_code == 201, response.text
    assert response.json()["reminder"]["status"] == "active"
    assert len(response.json()["attachments"]) == 1


def test_actions_settings_stale_notifications_and_ownership(owner, channel):
    message = create(owner, channel)
    path = f"{API}/messages/{message['id']}/reminder/actions"
    assert (
        owner.put(
            f"{API}/notifications/settings", json={"snooze_minutes": 25, "enabled": True}
        ).status_code
        == 200
    )
    before = utc_now()
    snoozed = owner.post(path, json={"revision": 1, "action": "snooze"}).json()
    assert (
        before + timedelta(minutes=24)
        < datetime.fromisoformat(snoozed["due_at"])
        < utc_now() + timedelta(minutes=26)
    )
    assert owner.post(path, json={"revision": 1, "action": "done"}).status_code == 409
    done = owner.post(path, json={"revision": 2, "action": "done"}).json()
    assert done["status"] == "done"
    restored = owner.post(path, json={"revision": 3, "action": "restore"}).json()
    assert restored["status"] == "active"
    assert (
        owner.post(
            f"{API}/messages/{uuid4()}/reminder/actions", json={"revision": 1, "action": "done"}
        ).status_code
        == 404
    )


def test_repeating_done_preserves_wall_clock_through_dst():
    anchor = datetime(2026, 3, 28, 8, tzinfo=UTC)
    next_due = next_occurrence(anchor, "daily", "Europe/Berlin", anchor)
    assert next_due == datetime(2026, 3, 29, 7, tzinfo=UTC)
    friday = datetime(2026, 10, 16, 9, tzinfo=UTC)
    assert next_occurrence(friday, "weekdays", "UTC", friday).weekday() == 0


def test_repeating_reminder_advances_instead_of_completing(owner, channel):
    message = create(owner, channel, repeat="daily")
    response = owner.post(
        f"{API}/messages/{message['id']}/reminder/actions", json={"revision": 1, "action": "done"}
    )
    assert response.status_code == 200
    assert response.json()["status"] == "active"
    assert datetime.fromisoformat(response.json()["due_at"]) > datetime.fromisoformat(
        message["reminder"]["due_at"]
    )


def test_push_config_stable_and_private_endpoints_rejected(owner):
    first = owner.get(f"{API}/notifications/config")
    assert first.status_code == 200, first.text
    assert first.json() == owner.get(f"{API}/notifications/config").json()
    assert set(first.json()) == {"public_key"}
    subscription = subscribe(owner)
    subscription["endpoint"] = "https://127.0.0.1/private"
    assert owner.post(f"{API}/notifications/subscriptions", json=subscription).status_code == 422


def test_notification_delivery_deduplicates_and_suppresses_phone(owner, channel, db, monkeypatch):
    owner.get(f"{API}/notifications/config")
    desktop = subscribe(owner)
    phone = subscribe(owner, "mobile")
    owner.post(
        f"{API}/notifications/presence",
        json={**{key: desktop[key] for key in ("device_id", "kind")}, "focused": True},
    )
    message = create(owner, channel)
    db.execute(
        update(Reminder)
        .where(Reminder.message_id == UUID(message["id"]))
        .values(due_at=utc_now() - timedelta(seconds=1))
    )
    db.commit()
    send = Mock()
    monkeypatch.setattr("pywebpush.webpush", send)
    dispatch_due(db.get_bind(), "https://noted.example.com")
    dispatch_due(db.get_bind(), "https://noted.example.com")
    assert send.call_count == 1
    assert send.call_args.kwargs["subscription_info"]["endpoint"] == desktop["endpoint"]
    payload = json.loads(send.call_args.kwargs["data"])
    assert "Programming / #python" == payload["title"]
    assert message["content"] == payload["body"]
    assert db.scalar(select(func.count()).select_from(NotificationDelivery)) == 2
    owner.post(
        f"{API}/notifications/presence",
        json={**{key: desktop[key] for key in ("device_id", "kind")}, "focused": False},
    )
    dispatch_due(db.get_bind(), "https://noted.example.com")
    assert send.call_count == 1
    assert phone["endpoint"] != desktop["endpoint"]


def test_backup_restores_reminders_without_notification_credentials(owner, channel, db):
    channel = reminder_channel(owner, channel)
    create(owner, channel, repeat="weekdays")
    owner.get(f"{API}/notifications/config")
    _, raw = export(owner)
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        content = json.loads(archive.read("content.json"))
    assert content["channels"][0]["kind"] == "reminder"
    assert content["messages"][0]["reminder"]["repeat"] == "weekdays"
    assert "private_key" not in json.dumps(content)
    preview = upload(owner, raw)
    response = owner.post(
        f"{API}/backups/import", json={"token": preview.json()["token"], "mode": "merge"}
    )
    assert response.status_code == 200, response.text
    restored = db.scalars(select(Reminder)).all()
    assert len(restored) == 2
    assert all(reminder.repeat == "weekdays" for reminder in restored)


def test_delivery_retries_failures_and_forgets_expired_subscriptions(
    owner, channel, db, monkeypatch
):
    from pywebpush import WebPushException
    from requests import Response

    owner.get(f"{API}/notifications/config")
    subscribe(owner)
    message = create(owner, channel)
    db.execute(
        update(Reminder)
        .where(Reminder.message_id == UUID(message["id"]))
        .values(due_at=utc_now() - timedelta(seconds=1))
    )
    db.commit()
    send = Mock(side_effect=WebPushException("Temporary failure"))
    monkeypatch.setattr("pywebpush.webpush", send)
    dispatch_due(db.get_bind(), "https://noted.example.com")
    dispatch_due(db.get_bind(), "https://noted.example.com")
    assert send.call_count == 1
    db.execute(update(NotificationDelivery).values(retry_at=utc_now() - timedelta(seconds=1)))
    db.commit()
    response = Response()
    response.status_code = 410
    send.side_effect = WebPushException("Expired subscription", response=response)
    dispatch_due(db.get_bind(), "https://noted.example.com")
    assert db.scalar(select(func.count()).select_from(PushSubscription)) == 0
    assert db.scalar(select(func.count()).select_from(NotificationDelivery)) == 0


def test_stale_desktop_presence_does_not_suppress_phone(owner, channel, db, monkeypatch):
    owner.get(f"{API}/notifications/config")
    desktop = subscribe(owner)
    subscribe(owner, "mobile")
    owner.post(
        f"{API}/notifications/presence",
        json={"device_id": desktop["device_id"], "kind": "desktop", "focused": True},
    )
    create(owner, channel)
    db.execute(update(DevicePresence).values(seen_at=utc_now() - timedelta(minutes=1)))
    db.execute(update(Reminder).values(due_at=utc_now() - timedelta(seconds=1)))
    db.commit()
    send = Mock()
    monkeypatch.setattr("pywebpush.webpush", send)
    dispatch_due(db.get_bind(), "https://noted.example.com")
    assert send.call_count == 2


def test_real_push_encryption_and_vapid_signing(owner, channel, db, monkeypatch):
    from requests import Response

    owner.get(f"{API}/notifications/config")
    subscribe(owner)
    message = create(owner, channel)
    message = owner.put(f"{API}/messages/{message['id']}", json={"content": "📝" * 500}).json()
    db.execute(update(Reminder).values(due_at=utc_now() - timedelta(seconds=1)))
    db.commit()
    response = Response()
    response.status_code = 201
    response._content = b""
    transport = Mock(return_value=response)
    monkeypatch.setattr("requests.post", transport)
    dispatch_due(db.get_bind(), "https://noted.example.com")
    assert transport.call_count == 1
    sent = transport.call_args.kwargs
    assert sent["headers"]["content-encoding"] == "aes128gcm"
    assert sent["headers"]["authorization"].startswith("vapid ")
    assert message["content"].encode() not in sent["data"]
    assert len(sent["data"]) < 4096
    assert db.scalar(select(NotificationDelivery.delivered_at)) is not None
