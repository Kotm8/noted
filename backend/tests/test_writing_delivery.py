import json
from datetime import timedelta
from unittest.mock import Mock
from uuid import uuid4

import pytest
from sqlalchemy import select

from app.auth.models import LoginSession
from app.core.security import utc_now
from app.notifications import routing
from app.notifications.models import DevicePresence, PushSubscription
from app.publishing import delivery
from app.publishing.models import WritingDelivery, WritingPrompt
from tests.conftest import API


@pytest.mark.parametrize("focused", [False, True])
def test_writing_push_uses_channel_context_and_deduplicates_with_desktop_focused(
    owner, channel, db, app, monkeypatch, focused
):
    now = utc_now()
    session = db.scalar(select(LoginSession))
    prompt = WritingPrompt(
        channel_id=channel["id"],
        owner_id=session.user_id,
        content="Write a daily note",
        start_at=now,
        timezone="UTC",
        frequency="daily",
        weekdays=[],
        due_at=now,
        next_at=now + timedelta(days=1),
        revision=2,
    )
    phone = PushSubscription(
        session_id=session.id,
        device_id=uuid4(),
        kind="mobile",
        endpoint="fcm:fixture:phone",
        keys={},
    )
    db.add_all(
        [
            prompt,
            phone,
            DevicePresence(
                session_id=session.id,
                device_id=uuid4(),
                kind="desktop",
                focused=focused,
                seen_at=now,
            ),
        ]
    )
    db.commit()
    send = Mock(return_value="accepted")
    monkeypatch.setattr(delivery, "utc_now", lambda: now)
    monkeypatch.setattr(routing, "send_push", send)
    delivery.dispatch_writing(db.get_bind(), app.state.settings, now - timedelta(seconds=1))
    delivery.dispatch_writing(db.get_bind(), app.state.settings, now - timedelta(seconds=1))
    send.assert_called_once()
    assert db.scalar(select(WritingDelivery.delivered_at)) is not None
    payload = json.loads(send.call_args.args[2])
    assert payload["kind"] == "writing"
    assert payload["body"] == "Write a daily note"
    assert payload["title"] == "Programming / #python"
    assert payload["url"].endswith(f"/c/{channel['id']}")
    assert "messageId" not in payload


def test_writing_push_retries_after_restart_and_respects_mute(owner, channel, db, app, monkeypatch):
    now = utc_now()
    session = db.scalar(select(LoginSession))
    db.add_all(
        [
            WritingPrompt(
                channel_id=channel["id"],
                owner_id=session.user_id,
                content="Write",
                start_at=now,
                timezone="UTC",
                frequency="daily",
                weekdays=[],
                due_at=now,
            ),
            PushSubscription(
                session_id=session.id,
                device_id=uuid4(),
                kind="mobile",
                endpoint="fcm:fixture:phone",
                keys={},
            ),
        ]
    )
    db.commit()
    send = Mock(return_value="accepted")
    monkeypatch.setattr(routing, "send_push", send)
    owner.put(f"{API}/notifications/settings", json={"android_enabled": False})
    delivery.dispatch_writing(db.get_bind(), app.state.settings, now - timedelta(seconds=1))
    send.assert_not_called()
    owner.put(f"{API}/notifications/settings", json={"android_enabled": True})
    delivery.dispatch_writing(db.get_bind(), app.state.settings, now + timedelta(seconds=1))
    send.assert_called_once()
