import json
from datetime import timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import delete, inspect, select
from sqlalchemy.orm import Session

from app.auth.models import LoginSession
from app.core.config import Settings
from app.core.security import utc_now
from app.notifications.delivery import send_push
from app.notifications.models import (
    DeliveryProgress,
    DevicePresence,
    NotificationKey,
    PushSubscription,
)
from app.notifications.schemas import NotificationSettings
from app.wear.models import WatchDevice


def delivery_targets(
    db: Session, user_id: UUID, preferences: NotificationSettings
) -> tuple[list[PushSubscription], list[PushSubscription]]:
    """Choose the one device that alerts, plus the subscriptions that stay quiet.

    A focused desktop takes priority, then the phone app, then Chrome on the phone,
    then other browsers. Paired watches always receive a copy, but only show it when
    their phone is unreachable, since the phone's notification is mirrored to them.
    """
    now = utc_now()
    sessions = select(LoginSession.id).where(
        LoginSession.user_id == user_id,
        LoginSession.live(now),
    )
    subscriptions = [
        item
        for item in db.scalars(
            select(PushSubscription).where(PushSubscription.session_id.in_(sessions))
        )
        if preferences.android_enabled or not item.endpoint.startswith("fcm:")
    ]
    focused = (
        db.scalar(
            select(DevicePresence.session_id)
            .where(
                DevicePresence.session_id.in_(sessions),
                DevicePresence.kind == "desktop",
                DevicePresence.focused.is_(True),
                DevicePresence.seen_at > now - timedelta(seconds=45),
            )
            .limit(1)
        )
        is not None
    )
    watch_sessions = set(db.scalars(select(WatchDevice.session_id)))
    watches = [item for item in subscriptions if item.session_id in watch_sessions]
    others = [item for item in subscriptions if item.session_id not in watch_sessions]
    native = [item for item in others if item.endpoint.startswith("fcm:")]
    browsers = [item for item in others if item.kind == "desktop" and item not in native]
    phone_browsers = [item for item in others if item not in native and item not in browsers]
    tiers = [browsers] if focused else [native, phone_browsers, browsers]
    targets = next((tier for tier in tiers if tier), [])
    if not focused:
        targets = targets + watches
    return targets, [item for item in subscriptions if item not in targets]


def deliver(
    db: Session,
    model: type[DeliveryProgress],
    item_id: UUID,
    revision: int,
    user_id: UUID,
    preferences: NotificationSettings,
    payload: str,
    *,
    origin: str,
    settings: Settings | None,
    max_attempts: int = 8,
    ttl: int = 86400,
) -> None:
    """Send one revision of a notification to its target device, at most once each."""
    now = utc_now()
    key = db.get(NotificationKey, 1)
    targets, quiet = delivery_targets(db, user_id, preferences)
    item = getattr(model, model.item_key) == item_id
    existing = {
        row.subscription_id: row
        for row in db.scalars(select(model).where(item, model.revision == revision))
    }

    def progress(subscription: PushSubscription) -> DeliveryProgress:
        row = existing.get(subscription.id)
        if row is None:
            row = model()
            setattr(row, model.item_key, item_id)
            row.subscription_id, row.revision = subscription.id, revision
            row.attempts, row.retry_at = 0, now
            db.add(row)
        return row

    for subscription in quiet:
        row = progress(subscription)
        if row.delivered_at is None:
            row.attempts = 0
            row.delivered_at = now
    for subscription in targets:
        row = progress(subscription)
        if row.delivered_at or row.retry_at > now or row.attempts >= max_attempts:
            continue
        row.attempts += 1
        row.retry_at = now + timedelta(seconds=min(3600, 15 * 2**row.attempts))
        private_key = key.private_key if key else ""
        result = send_push(subscription, private_key, origin, payload, ttl=ttl, settings=settings)
        if result == "accepted":
            row.delivered_at = now
        elif result == "expired":
            db.delete(subscription)
    db.flush()


def dismiss_handled(
    db: Session,
    model: type[DeliveryProgress],
    item_model: Any,
    kind: str,
    *,
    origin: str,
    settings: Settings | None,
) -> None:
    """Clear a notification on every device once its revision has been acted on."""
    key = db.get(NotificationKey, 1)
    linked = getattr(model, model.item_key) == inspect(item_model).primary_key[0]
    handled = model.revision < item_model.revision
    shown = (model.attempts > 0) & (model.delivered_at > utc_now() - timedelta(days=2))
    rows = db.execute(
        select(model, PushSubscription)
        .join(PushSubscription, PushSubscription.id == model.subscription_id)
        .join(item_model, linked)
        .where(handled, shown)
        .limit(100)
    ).all()
    for delivery, subscription in rows:
        db.delete(delivery)
        # Browsers must show something for every push, so they are not sent silent clears.
        if not subscription.endpoint.startswith("fcm:"):
            continue
        payload = json.dumps(
            {
                "kind": "dismiss",
                "target": kind,
                "id": str(getattr(delivery, model.item_key)),
                "revision": delivery.revision,
            }
        )
        private_key = key.private_key if key else ""
        send_push(subscription, private_key, origin, payload, settings=settings, urgent=False)
    db.execute(delete(model).where(linked, handled, ~shown))
    db.commit()
