import io
import json
import zipfile
from datetime import UTC, datetime, timedelta
from unittest.mock import Mock
from uuid import UUID, uuid4

import pytest
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.auth.services.sessions import SessionService
from app.core.config import Settings
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


def subscribe(owner, kind="mobile"):
    body = {
        "device_id": str(uuid4()),
        "kind": kind,
        "endpoint": f"fcm:fixture:{uuid4()}",
        "keys": {},
    }
    with Session(owner.app.state.engine) as db:
        session = SessionService(db).authenticate(owner.cookies["noted_session"]).session
        db.add(
            PushSubscription(
                session_id=session.id, **{**body, "device_id": UUID(body["device_id"])}
            )
        )
        db.commit()
    return body


def legacy_subscription(owner, kind="desktop"):
    body = subscribe(owner, kind)
    with Session(owner.app.state.engine) as db:
        row = db.scalar(
            select(PushSubscription).where(PushSubscription.endpoint == body["endpoint"])
        )
        body["endpoint"] = f"https://fcm.googleapis.com/fcm/send/{uuid4()}"
        row.endpoint = body["endpoint"]
        db.commit()
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


def test_schedule_existing_note_from_its_actions(owner, channel):
    note = owner.post(
        f"{API}/channels/{channel['id']}/messages", json={"content": "Remember this"}
    ).json()
    path = f"{API}/messages/{note['id']}/reminder"
    created = owner.put(path, json=schedule())
    assert created.status_code == 200, created.text
    assert created.json()["revision"] == 1
    assert (
        owner.get(f"{API}/channels/{channel['id']}/messages").json()["items"][0]["reminder"][
            "status"
        ]
        == "active"
    )
    changed = owner.put(path, json=schedule())
    assert changed.status_code == 200 and changed.json()["revision"] == 2


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


def test_browser_push_registration_and_config_are_removed(owner):
    assert owner.get(f"{API}/notifications/config").status_code == 404
    assert owner.post(f"{API}/notifications/subscriptions", json={}).status_code == 404


def test_notification_delivery_deduplicates_and_ignores_legacy_browsers(
    owner, channel, db, app, monkeypatch
):
    legacy_subscription(owner)
    legacy_subscription(owner, "mobile")
    phone = subscribe(owner)
    message = create(owner, channel)
    db.execute(update(Reminder).values(due_at=utc_now() - timedelta(seconds=1)))
    db.commit()
    send = Mock(return_value="accepted")
    monkeypatch.setattr("app.notifications.delivery.send_firebase", send)
    for _ in range(2):
        dispatch_due(db.get_bind(), app.state.settings.app_origin, app.state.settings)
    assert send.call_count == 1
    assert send.call_args.args[0] == phone["endpoint"]
    payload = json.loads(send.call_args.args[3])
    assert payload["title"] == "Programming / #python"
    assert payload["body"] == message["content"]
    assert db.scalar(select(func.count()).select_from(NotificationDelivery)) == 1


def test_backup_restores_reminders_without_notification_credentials(owner, channel, db):
    channel = reminder_channel(owner, channel)
    create(owner, channel, repeat="weekdays")
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
    owner, channel, db, app, monkeypatch
):
    subscribe(owner)
    create(owner, channel)
    db.execute(update(Reminder).values(due_at=utc_now() - timedelta(seconds=1)))
    db.commit()
    send = Mock(return_value="failed")
    monkeypatch.setattr("app.notifications.delivery.send_firebase", send)
    for _ in range(2):
        dispatch_due(db.get_bind(), app.state.settings.app_origin, app.state.settings)
    assert send.call_count == 1
    db.execute(update(NotificationDelivery).values(retry_at=utc_now() - timedelta(seconds=1)))
    db.commit()
    send.return_value = "expired"
    dispatch_due(db.get_bind(), app.state.settings.app_origin, app.state.settings)
    assert db.scalar(select(func.count()).select_from(PushSubscription)) == 0
    assert db.scalar(select(func.count()).select_from(NotificationDelivery)) == 0


def test_stale_desktop_presence_does_not_suppress_phone(owner, channel, db, app, monkeypatch):
    phone = subscribe(owner)
    owner.post(
        f"{API}/notifications/presence",
        json={"device_id": str(uuid4()), "kind": "desktop", "focused": True},
    )
    create(owner, channel)
    db.execute(update(DevicePresence).values(seen_at=utc_now() - timedelta(minutes=1)))
    db.execute(update(Reminder).values(due_at=utc_now() - timedelta(seconds=1)))
    db.commit()
    send = Mock(return_value="accepted")
    monkeypatch.setattr("app.notifications.delivery.send_firebase", send)
    dispatch_due(db.get_bind(), app.state.settings.app_origin, app.state.settings)
    assert send.call_count == 1
    assert send.call_args.args[0] == phone["endpoint"]


def test_legacy_endpoints_never_reach_a_push_transport(monkeypatch):
    from app.notifications.delivery import send_push

    send = Mock()
    monkeypatch.setattr("app.notifications.delivery.send_firebase", send)
    subscription = PushSubscription(endpoint="https://fcm.googleapis.com/fcm/send/legacy")
    assert (
        send_push(subscription, "https://notes.example.com", "{}", settings=Settings()) == "expired"
    )
    send.assert_not_called()


def test_native_push_migration_removes_browser_credentials_and_preserves_phone_delivery(
    owner, channel, db, engine
):
    from pathlib import Path

    from alembic.config import Config
    from sqlalchemy import inspect, text

    from alembic import command

    phone = subscribe(owner)
    browser = legacy_subscription(owner)
    message = create(owner, channel)
    for endpoint in (phone["endpoint"], browser["endpoint"]):
        subscription = db.scalar(
            select(PushSubscription).where(PushSubscription.endpoint == endpoint)
        )
        db.add(
            NotificationDelivery(
                message_id=UUID(message["id"]),
                subscription_id=subscription.id,
                revision=1,
                attempts=1,
                delivered_at=utc_now(),
            )
        )
    db.commit()
    config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    with engine.begin() as connection:
        config.attributes["connection"] = connection
        command.downgrade(config, "0034_document_reminders")
        connection.execute(text("INSERT INTO notification_keys VALUES (1, 'legacy-key')"))
        command.upgrade(config, "head")
        assert not inspect(connection).has_table("notification_keys")
    db.expire_all()
    assert list(db.scalars(select(PushSubscription.endpoint))) == [phone["endpoint"]]
    assert db.scalar(select(func.count()).select_from(NotificationDelivery)) == 1
    assert owner.get(f"{API}/auth/session").status_code == 200
