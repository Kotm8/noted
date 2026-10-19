import asyncio
import json
import logging
from datetime import timedelta

from sqlalchemy import or_, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from app.auth.models import LoginSession, User
from app.core.config import Settings
from app.core.security import utc_now
from app.notes.models import Message
from app.notifications.delivery import send_push
from app.notifications.models import (
    DevicePresence,
    NotificationDelivery,
    NotificationKey,
    PushSubscription,
)
from app.notifications.schemas import NotificationSettings
from app.reminders.models import Reminder
from app.workspaces.models import Channel, Workspace

logger = logging.getLogger(__name__)


def dispatch_due(engine: Engine, origin: str, settings: Settings | None = None) -> None:
    with Session(engine) as db:
        key = db.get(NotificationKey, 1)
        finished_delivery = (
            select(NotificationDelivery.message_id)
            .where(
                NotificationDelivery.message_id == Reminder.message_id,
                NotificationDelivery.subscription_id == PushSubscription.id,
                NotificationDelivery.revision == Reminder.revision,
                or_(
                    NotificationDelivery.delivered_at.is_not(None),
                    NotificationDelivery.attempts >= 8,
                    NotificationDelivery.retry_at > utc_now(),
                ),
            )
            .correlate(Reminder, PushSubscription)
            .exists()
        )
        pending_subscription = (
            select(PushSubscription.id)
            .join(LoginSession)
            .where(
                LoginSession.user_id == Message.author_id,
                LoginSession.revoked_at.is_(None),
                LoginSession.expires_at > utc_now(),
                ~finished_delivery,
            )
            .correlate(Reminder, Message)
            .exists()
        )
        reminders = db.scalars(
            select(Reminder)
            .join(Message)
            .where(
                Reminder.status == "active",
                Reminder.due_at <= utc_now(),
                Message.deleted_at.is_(None),
                pending_subscription,
            )
            .order_by(Reminder.due_at)
            .limit(50)
            .with_for_update(of=Reminder, skip_locked=True)
        ).all()
        for reminder in reminders:
            message = db.get(Message, reminder.message_id)
            if message is None:
                continue
            user = db.get(User, message.author_id)
            if user is None:
                continue
            preferences = NotificationSettings.model_validate(user.notification_preferences or {})
            if not preferences.enabled:
                continue
            sessions = select(LoginSession.id).where(
                LoginSession.user_id == user.id,
                LoginSession.revoked_at.is_(None),
                LoginSession.expires_at > utc_now(),
            )
            desktop_focused = (
                db.scalar(
                    select(DevicePresence.session_id)
                    .where(
                        DevicePresence.session_id.in_(sessions),
                        DevicePresence.kind == "desktop",
                        DevicePresence.focused.is_(True),
                        DevicePresence.seen_at > utc_now() - timedelta(seconds=45),
                    )
                    .limit(1)
                )
                is not None
            )
            subscriptions = db.scalars(
                select(PushSubscription).where(PushSubscription.session_id.in_(sessions))
            ).all()
            channel = db.get(Channel, message.channel_id)
            if channel is None:
                continue
            project = db.get(Workspace, channel.workspace_id)
            if project is None:
                continue
            payload = json.dumps(
                {
                    "title": f"{project.name} / #{channel.name}",
                    "body": message.content[:500] or "Attachment reminder",
                    "messageId": str(message.id),
                    "revision": reminder.revision,
                    "url": f"/w/{project.id}/c/{channel.id}?note={message.id}",
                    "snoozeMinutes": preferences.snooze_minutes,
                },
                ensure_ascii=False,
            )
            for subscription in subscriptions:
                if subscription.endpoint.startswith("fcm:") and not preferences.android_enabled:
                    continue
                identity = (reminder.message_id, subscription.id, reminder.revision)
                delivery = db.get(NotificationDelivery, identity)
                if delivery and (
                    delivery.delivered_at or delivery.retry_at > utc_now() or delivery.attempts >= 8
                ):
                    continue
                if delivery is None:
                    delivery = NotificationDelivery(
                        message_id=reminder.message_id,
                        subscription_id=subscription.id,
                        revision=reminder.revision,
                        attempts=0,
                        retry_at=utc_now(),
                    )
                    db.add(delivery)
                delivery.attempts += 1
                delivery.retry_at = utc_now() + timedelta(
                    seconds=min(3600, 15 * 2**delivery.attempts)
                )
                if desktop_focused and subscription.kind == "mobile":
                    delivery.delivered_at = utc_now()
                    continue
                result = send_push(
                    subscription, key.private_key if key else "", origin, payload, settings=settings
                )
                if result == "expired":
                    db.delete(subscription)
                elif result == "accepted":
                    delivery.delivered_at = utc_now()
            db.flush()
        db.commit()


async def notification_worker(
    engine: Engine, origin: str, settings: Settings | None = None
) -> None:
    from app.publishing.delivery import dispatch_writing
    from app.schedule.prompts.delivery import dispatch_plan_prompts

    started = utc_now()
    while True:
        try:
            await asyncio.to_thread(dispatch_due, engine, origin, settings)
            await asyncio.to_thread(dispatch_plan_prompts, engine, origin, settings)
            if settings and not (settings.maintenance_path and settings.maintenance_path.exists()):
                await asyncio.to_thread(dispatch_writing, engine, settings, started)
        except Exception:
            logger.exception("Notification delivery cycle failed")
        await asyncio.sleep(5)
