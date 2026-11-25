import json

from sqlalchemy import or_, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from app.auth.models import LoginSession, User
from app.core.config import Settings
from app.core.security import utc_now
from app.notes.documents.reminders.models import DocumentReminder, DocumentReminderDelivery
from app.notifications.models import PushSubscription
from app.notifications.routing import deliver, dismiss_handled
from app.notifications.schemas import NotificationSettings
from app.workspaces.models import Channel, Workspace


def dispatch_document_reminders(engine: Engine, settings: Settings) -> None:
    with Session(engine) as db:
        finished = (
            select(DocumentReminderDelivery.reminder_id)
            .where(
                DocumentReminderDelivery.reminder_id == DocumentReminder.id,
                DocumentReminderDelivery.subscription_id == PushSubscription.id,
                DocumentReminderDelivery.revision == DocumentReminder.revision,
                or_(
                    DocumentReminderDelivery.delivered_at.is_not(None),
                    DocumentReminderDelivery.attempts >= 8,
                    DocumentReminderDelivery.retry_at > utc_now(),
                ),
            )
            .correlate(DocumentReminder, PushSubscription)
            .exists()
        )
        pending = (
            select(PushSubscription.id)
            .join(LoginSession)
            .where(
                LoginSession.user_id == DocumentReminder.owner_id, LoginSession.live(), ~finished
            )
            .correlate(DocumentReminder)
            .exists()
        )
        rows = db.scalars(
            select(DocumentReminder)
            .join(Channel)
            .where(
                DocumentReminder.status == "active",
                DocumentReminder.read_revision < DocumentReminder.revision,
                DocumentReminder.due_at <= utc_now(),
                Channel.kind == "document",
                pending,
            )
            .order_by(DocumentReminder.urgent.desc(), DocumentReminder.due_at)
            .limit(50)
            .with_for_update(of=DocumentReminder, skip_locked=True)
        )
        for row in rows:
            user = db.get(User, row.owner_id)
            channel = db.get(Channel, row.channel_id)
            project = db.get(Workspace, channel.workspace_id) if channel else None
            if user is None or channel is None or project is None:
                continue
            preferences = NotificationSettings.model_validate(user.notification_preferences or {})
            if not preferences.enabled:
                continue
            payload = json.dumps(
                {
                    "kind": "document",
                    "messageId": str(row.id),
                    "revision": row.revision,
                    "title": f"{project.name} / {channel.name}",
                    "body": row.name,
                    "url": f"/w/{project.id}/c/{channel.id}?documentReminder={row.id}",
                },
                ensure_ascii=False,
            )
            deliver(
                db,
                DocumentReminderDelivery,
                row.id,
                row.revision,
                row.owner_id,
                preferences,
                payload,
                origin=settings.app_origin,
                settings=settings,
                urgent=row.urgent,
            )
        db.commit()
    with Session(engine) as db:
        dismiss_handled(
            db,
            DocumentReminderDelivery,
            DocumentReminder,
            "document",
            origin=settings.app_origin,
            settings=settings,
        )
