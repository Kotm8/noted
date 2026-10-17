from datetime import UTC, datetime, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.core.security import utc_now
from app.notes.models import Message
from app.reminders.models import Reminder
from app.reminders.schemas import ReminderAction, ReminderSchedule
from app.workspaces.services.channels import ChannelService


def attach_reminder(db: Session, message: Message, schedule: ReminderSchedule | None) -> None:
    channel = ChannelService(db).get_channel(message.channel_id, message.author_id)
    if schedule is None:
        if channel.kind == "reminder":
            raise ValidationError("Every message in a reminder channel needs a reminder time.")
        return
    if schedule.due_at <= utc_now():
        raise ValidationError("Choose a reminder time in the future.")
    message.reminder = Reminder(
        due_at=schedule.due_at,
        scheduled_at=schedule.due_at,
        timezone=schedule.timezone,
        repeat=schedule.repeat,
    )


def next_occurrence(anchor: datetime, rule: str, timezone: str, now: datetime) -> datetime:
    local = anchor.astimezone(ZoneInfo(timezone))
    while True:
        local += timedelta(days=7 if rule == "weekly" else 1)
        if local > now and (rule != "weekdays" or local.weekday() < 5):
            return local.astimezone(UTC)


class ReminderService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get(self, message_id: UUID, owner_id: UUID) -> Reminder:
        reminder = self.db.scalar(
            select(Reminder)
            .join(Message)
            .where(
                Reminder.message_id == message_id,
                Message.author_id == owner_id,
                Message.deleted_at.is_(None),
            )
            .with_for_update(of=Reminder)
        )
        if reminder is None:
            raise NotFoundError("Reminder not found")
        return reminder

    def schedule(self, message_id: UUID, owner_id: UUID, data: ReminderSchedule) -> Reminder:
        reminder = self.get(message_id, owner_id)
        if data.due_at <= utc_now():
            raise ValidationError("Choose a reminder time in the future.")
        reminder.due_at = reminder.scheduled_at = data.due_at
        reminder.timezone, reminder.repeat = data.timezone, data.repeat
        reminder.status = "active"
        reminder.revision += 1
        self.db.commit()
        self.db.refresh(reminder)
        return reminder

    def act(self, message_id: UUID, owner_id: UUID, data: ReminderAction) -> Reminder:
        reminder = self.get(message_id, owner_id)
        if data.revision != reminder.revision:
            raise ConflictError("This reminder changed. Refresh it before trying again.")
        if data.action == "snooze":
            from app.auth.models import User
            from app.notifications.schemas import NotificationSettings

            user = self.db.get(User, owner_id)
            if user is None:
                raise NotFoundError("Account not found")
            settings = NotificationSettings.model_validate(user.notification_preferences or {})
            reminder.due_at = utc_now() + timedelta(minutes=data.minutes or settings.snooze_minutes)
            reminder.status = "active"
        elif data.action == "restore":
            reminder.status = "active"
        elif reminder.repeat != "none":
            reminder.due_at = reminder.scheduled_at = next_occurrence(
                reminder.scheduled_at, reminder.repeat, reminder.timezone, utc_now()
            )
            reminder.status = "active"
        else:
            reminder.status = "done"
        reminder.revision += 1
        self.db.commit()
        self.db.refresh(reminder)
        return reminder
