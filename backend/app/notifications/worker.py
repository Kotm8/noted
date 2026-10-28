import json
import logging

from sqlalchemy import or_, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from app.auth.models import LoginSession, User
from app.core.config import Settings
from app.core.security import utc_now
from app.notes.mentions import readable
from app.notes.models import Message
from app.notifications.models import NotificationDelivery, PushSubscription
from app.notifications.routing import deliver, dismiss_handled
from app.notifications.schemas import NotificationSettings
from app.reminders.models import Reminder
from app.workspaces.models import Channel, Workspace

logger = logging.getLogger(__name__)


def dispatch_due(engine: Engine, origin: str, settings: Settings | None = None) -> None:
    with Session(engine) as db:
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
                LoginSession.live(),
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
            channel = db.get(Channel, message.channel_id)
            if channel is None:
                continue
            project = db.get(Workspace, channel.workspace_id)
            if project is None:
                continue
            payload = json.dumps(
                {
                    "title": f"{project.name} / #{channel.name}",
                    "body": readable(message.content)[:500] or "Attachment reminder",
                    "messageId": str(message.id),
                    "revision": reminder.revision,
                    "url": f"/w/{project.id}/c/{channel.id}?note={message.id}",
                    "snoozeMinutes": preferences.snooze_minutes,
                },
                ensure_ascii=False,
            )

            deliver(
                db,
                NotificationDelivery,
                reminder.message_id,
                reminder.revision,
                user.id,
                preferences,
                payload,
                origin=origin,
                settings=settings,
            )
        db.commit()


def dispatch_dismissals(engine: Engine, origin: str, settings: Settings | None = None) -> None:
    from app.publishing.models import WritingDelivery, WritingPrompt
    from app.schedule.prompts.models import PlanPrompt, PlanPromptDelivery

    with Session(engine) as db:
        for model, item, kind in (
            (NotificationDelivery, Reminder, "reminder"),
            (PlanPromptDelivery, PlanPrompt, "plan"),
            (WritingDelivery, WritingPrompt, "writing"),
        ):
            dismiss_handled(db, model, item, kind, origin=origin, settings=settings)
