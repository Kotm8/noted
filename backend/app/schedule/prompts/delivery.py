import json
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from app.auth.models import LoginSession, User
from app.core.config import Settings
from app.core.security import utc_now
from app.notifications.delivery import send_push
from app.notifications.models import DevicePresence, NotificationKey, PushSubscription
from app.notifications.schemas import NotificationSettings
from app.schedule.models import SchedulePlan
from app.schedule.prompts.models import PlanPrompt, PlanPromptDelivery
from app.schedule.prompts.service import refresh_prompts
from app.time_tracking.models import Activity


def dispatch_plan_prompts(engine: Engine, origin: str, settings: Settings | None) -> None:
    with Session(engine) as db:
        owners = db.scalars(
            select(SchedulePlan.owner_id).where(SchedulePlan.deleted_at.is_(None)).distinct()
        ).all()
        for owner_id in owners:
            refresh_prompts(db, owner_id)
            db.commit()
        prompts = db.scalars(
            select(PlanPrompt)
            .where(PlanPrompt.status == "pending", PlanPrompt.notify_at <= utc_now())
            .order_by(PlanPrompt.notify_at)
            .limit(50)
            .with_for_update(skip_locked=True)
        ).all()
        key = db.get(NotificationKey, 1)
        for prompt in prompts:
            user = db.get(User, prompt.owner_id)
            activity = db.get(Activity, prompt.activity_id)
            if user is None or activity is None or activity.archived:
                continue
            preferences = NotificationSettings.model_validate(user.notification_preferences or {})
            if not preferences.enabled:
                continue
            sessions = select(LoginSession.id).where(
                LoginSession.user_id == user.id,
                LoginSession.revoked_at.is_(None),
                LoginSession.expires_at > utc_now(),
            )
            focused = (
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
            plan = db.get(SchedulePlan, prompt.plan_id)
            payload = json.dumps(
                {
                    "kind": "plan",
                    "phase": prompt.phase,
                    "snoozeMinutes": preferences.snooze_minutes
                    if preferences.snooze_minutes in {5, 10, 15, 30, 60}
                    else 5,
                    "promptId": str(prompt.id),
                    "revision": prompt.revision,
                    "activityId": str(activity.id),
                    "activityName": activity.name,
                    "title": f"{activity.name} has ended"
                    if prompt.phase == "end"
                    else f"Time for {activity.name}",
                    "body": f"{prompt.title}. Stop tracking or snooze to keep going."
                    if prompt.phase == "end"
                    else prompt.title,
                    "plannedStart": prompt.planned_start.isoformat(),
                    "plannedEnd": prompt.planned_end.isoformat() if prompt.planned_end else None,
                    "timezone": plan.timezone if plan else "UTC",
                    "url": f"/schedule?prompt={prompt.id}",
                },
                ensure_ascii=False,
            )
            for subscription in subscriptions:
                if subscription.endpoint.startswith("fcm:") and not preferences.android_enabled:
                    continue
                identity = (prompt.id, subscription.id, prompt.revision)
                delivery = db.get(PlanPromptDelivery, identity)
                if delivery and (
                    delivery.delivered_at or delivery.retry_at > utc_now() or delivery.attempts >= 8
                ):
                    continue
                if delivery is None:
                    delivery = PlanPromptDelivery(
                        prompt_id=prompt.id,
                        subscription_id=subscription.id,
                        revision=prompt.revision,
                        attempts=0,
                        retry_at=utc_now(),
                    )
                    db.add(delivery)
                delivery.attempts += 1
                delivery.retry_at = utc_now() + timedelta(
                    seconds=min(3600, 15 * 2**delivery.attempts)
                )
                if focused and subscription.kind == "mobile":
                    delivery.delivered_at = utc_now()
                    continue
                result = send_push(
                    subscription, key.private_key if key else "", origin, payload, settings=settings
                )
                if result == "accepted":
                    delivery.delivered_at = utc_now()
                elif result == "expired":
                    db.delete(subscription)
            db.flush()
        db.commit()
