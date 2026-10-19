import json
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from app.auth.models import LoginSession, User
from app.core.config import Settings
from app.core.security import utc_now
from app.notifications.delivery import send_push
from app.notifications.models import DevicePresence, NotificationKey, PushSubscription
from app.notifications.schemas import NotificationSettings
from app.publishing.models import WritingDelivery, WritingPrompt
from app.workspaces.models import Channel, Workspace


def dispatch_writing(engine: Engine, settings: Settings, started: datetime) -> None:
    now = utc_now()
    with Session(engine) as db:
        key = db.get(NotificationKey, 1)
        prompts = db.scalars(
            select(WritingPrompt)
            .where(
                WritingPrompt.enabled.is_(True),
                WritingPrompt.due_at >= max(started, now - timedelta(minutes=5)),
                WritingPrompt.due_at <= now,
            )
            .limit(50)
            .with_for_update(skip_locked=True)
        ).all()
        for prompt in prompts:
            user = db.get(User, prompt.owner_id)
            channel = db.get(Channel, prompt.channel_id)
            project = db.get(Workspace, channel.workspace_id) if channel else None
            if user is None or channel is None or project is None:
                continue
            preferences = NotificationSettings.model_validate(user.notification_preferences or {})
            if not preferences.enabled:
                continue
            sessions = select(LoginSession.id).where(
                LoginSession.user_id == user.id,
                LoginSession.revoked_at.is_(None),
                LoginSession.expires_at > now,
            )
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
            subscriptions = db.scalars(
                select(PushSubscription).where(PushSubscription.session_id.in_(sessions))
            ).all()
            payload = json.dumps(
                {
                    "kind": "writing",
                    "writingPromptId": str(prompt.id),
                    "revision": prompt.revision,
                    "title": f"{project.name} / #{channel.name}",
                    "body": prompt.content,
                    "url": f"/w/{project.id}/c/{channel.id}",
                },
                ensure_ascii=False,
            )
            for subscription in subscriptions:
                if subscription.endpoint.startswith("fcm:") and not preferences.android_enabled:
                    continue
                delivery = db.get(WritingDelivery, (prompt.id, subscription.id, prompt.revision))
                if delivery and (
                    delivery.delivered_at or delivery.retry_at > now or delivery.attempts >= 4
                ):
                    continue
                if delivery is None:
                    delivery = WritingDelivery(
                        prompt_id=prompt.id,
                        subscription_id=subscription.id,
                        revision=prompt.revision,
                        attempts=0,
                        retry_at=now,
                    )
                    db.add(delivery)
                delivery.attempts += 1
                delivery.retry_at = now + timedelta(seconds=15 * 2**delivery.attempts)
                if focused and subscription.kind == "mobile":
                    delivery.delivered_at = now
                    continue
                result = send_push(
                    subscription,
                    key.private_key if key else "",
                    settings.app_origin,
                    payload,
                    ttl=300,
                    settings=settings,
                )
                if result == "accepted":
                    delivery.delivered_at = now
                elif result == "expired":
                    db.delete(subscription)
            db.flush()
        db.commit()
