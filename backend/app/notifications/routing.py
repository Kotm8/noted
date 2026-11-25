import json
from datetime import timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import delete, inspect, or_, select
from sqlalchemy.orm import Session

from app.auth.models import LoginSession
from app.core.config import Settings
from app.core.security import utc_now
from app.notifications.delivery import send_push
from app.notifications.models import (
    DeliveryProgress,
    PushSubscription,
)
from app.notifications.quiet import in_quiet_hours
from app.notifications.schemas import NotificationSettings


def delivery_targets(
    db: Session, user_id: UUID, preferences: NotificationSettings
) -> list[PushSubscription]:
    now = utc_now()
    sessions = select(LoginSession.id).where(
        LoginSession.user_id == user_id,
        LoginSession.live(now),
    )
    return [
        item
        for item in db.scalars(
            select(PushSubscription).where(PushSubscription.session_id.in_(sessions))
        )
        if preferences.android_enabled and item.endpoint.startswith("fcm:")
    ]


def pending_delivery(
    model: type[DeliveryProgress], item: Any, owner_id: Any, max_attempts: int = 8
) -> Any:
    now = utc_now()
    finished = (
        select(model.subscription_id)
        .where(
            getattr(model, model.item_key) == item.id,
            model.subscription_id == PushSubscription.id,
            model.revision == item.revision,
            or_(
                model.delivered_at.is_not(None),
                model.attempts >= max_attempts,
                model.retry_at > now,
            ),
        )
        .correlate(item, PushSubscription)
        .exists()
    )
    return (
        select(PushSubscription.id)
        .join(LoginSession)
        .where(
            LoginSession.user_id == owner_id,
            LoginSession.live(now),
            PushSubscription.endpoint.startswith("fcm:"),
            ~finished,
        )
        .correlate(item)
        .exists()
    )


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
    covered: set[UUID] | None = None,
    urgent: bool = False,
) -> set[UUID]:
    """Send one revision of a notification to its target device, at most once each.

    ``covered`` contains subscriptions already covered by an accepted group notification.
    """
    now = utc_now()
    if covered is None and not urgent and in_quiet_hours(db, user_id, preferences, now):
        return set()
    targets = delivery_targets(db, user_id, preferences)
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

    accepted: set[UUID] = set()
    for subscription in targets:
        if covered is not None and subscription.id not in covered:
            continue
        row = progress(subscription)
        if row.delivered_at:
            continue
        if covered is not None:
            row.delivered_at = now
            continue
        if row.retry_at > now or row.attempts >= max_attempts:
            continue
        row.attempts += 1
        row.retry_at = now + timedelta(seconds=min(3600, 15 * 2**row.attempts))
        result = send_push(subscription, origin, payload, ttl=ttl, settings=settings)
        if result == "accepted":
            row.delivered_at = now
            row.retry_at = now
            accepted.add(subscription.id)
        elif result == "expired":
            db.delete(subscription)
    db.flush()
    return accepted


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
    linked = getattr(model, model.item_key) == inspect(item_model).primary_key[0]
    handled = model.revision < item_model.revision
    if hasattr(item_model, "read_revision"):
        handled |= model.revision <= item_model.read_revision
    shown = (model.attempts > 0) & (model.delivered_at > utc_now() - timedelta(days=2))
    rows = db.execute(
        select(model, PushSubscription)
        .join(PushSubscription, PushSubscription.id == model.subscription_id)
        .join(item_model, linked)
        .where(handled, shown, model.retry_at <= utc_now())
        .limit(100)
    ).all()
    for delivery, subscription in rows:
        if not subscription.endpoint.startswith("fcm:"):
            db.delete(delivery)
            continue
        payload = json.dumps(
            {
                "kind": "dismiss",
                "target": kind,
                "id": str(getattr(delivery, model.item_key)),
                "revision": delivery.revision,
            }
        )
        result = send_push(subscription, origin, payload, settings=settings, urgent=False)
        if result in {"accepted", "expired"}:
            db.delete(delivery)
        else:
            delivery.retry_at = utc_now() + timedelta(seconds=30)
    db.execute(delete(model).where(linked, handled, ~shown))
    db.commit()
