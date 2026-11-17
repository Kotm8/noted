from datetime import timedelta
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth.models import User
from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.core.security import utc_now
from app.notes.documents.reminders.models import DocumentReminder
from app.notes.documents.reminders.schemas import DocumentReminderCreate, DocumentReminderUpdate
from app.notifications.schemas import NotificationSettings
from app.reminders.schemas import ReminderAction
from app.reminders.service import next_occurrence
from app.workspaces.models import Channel
from app.workspaces.services.channels import ChannelService


class DocumentReminderService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def channel(self, channel_id: UUID, owner: UUID) -> None:
        if ChannelService(self.db).get_channel(channel_id, owner).kind != "document":
            raise ValidationError("Choose a Notes channel")

    def list(self, channel_id: UUID, owner: UUID) -> list[DocumentReminder]:
        self.channel(channel_id, owner)
        return list(
            self.db.scalars(
                select(DocumentReminder)
                .where(
                    DocumentReminder.channel_id == channel_id,
                    DocumentReminder.owner_id == owner,
                    DocumentReminder.status != "cancelled",
                )
                .order_by(DocumentReminder.created_at)
            )
        )

    def get(self, identifier: UUID, owner: UUID) -> DocumentReminder:
        row = self.db.scalar(
            select(DocumentReminder)
            .where(
                DocumentReminder.id == identifier,
                DocumentReminder.owner_id == owner,
                DocumentReminder.status != "cancelled",
            )
            .with_for_update()
        )
        if row is None:
            raise NotFoundError("Note reminder not found")
        self.channel(row.channel_id, owner)
        return row

    def create(
        self, channel_id: UUID, owner: UUID, data: DocumentReminderCreate
    ) -> DocumentReminder:
        self.channel(channel_id, owner)
        self.db.scalar(select(Channel).where(Channel.id == channel_id).with_for_update())
        if existing := self.db.get(DocumentReminder, data.id):
            if (
                existing.owner_id != owner
                or existing.channel_id != channel_id
                or existing.name != data.name
                or existing.scheduled_at != data.due_at
                or existing.timezone != data.timezone
                or existing.repeat != data.repeat
                or existing.urgent != data.urgent
            ):
                raise ConflictError("This reminder request has already been used")
            return existing
        count = self.db.scalar(
            select(func.count())
            .select_from(DocumentReminder)
            .where(
                DocumentReminder.channel_id == channel_id, DocumentReminder.status != "cancelled"
            )
        )
        if count and count >= 1000:
            raise ValidationError("This note already has 1,000 reminders")
        if data.due_at <= utc_now():
            raise ValidationError("Choose a reminder time in the future")
        row = DocumentReminder(
            channel_id=channel_id, owner_id=owner, scheduled_at=data.due_at, **data.model_dump()
        )
        self.db.add(row)
        self.db.commit()
        self.db.refresh(row)
        return row

    def update(
        self, identifier: UUID, owner: UUID, data: DocumentReminderUpdate
    ) -> DocumentReminder:
        row = self.get(identifier, owner)
        self.check_revision(row, data.revision)
        if data.due_at <= utc_now():
            raise ValidationError("Choose a reminder time in the future")
        for name, value in data.model_dump(exclude={"revision"}).items():
            setattr(row, name, value)
        row.scheduled_at = data.due_at
        row.status = "active"
        return self.save(row)

    def act(self, identifier: UUID, owner: UUID, data: ReminderAction) -> DocumentReminder:
        row = self.get(identifier, owner)
        self.check_revision(row, data.revision)
        if data.action == "snooze":
            user = self.db.get(User, owner)
            if user is None:
                raise NotFoundError("Account not found")
            settings = NotificationSettings.model_validate(user.notification_preferences or {})
            row.due_at = utc_now() + timedelta(minutes=data.minutes or settings.snooze_minutes)
            row.status = "active"
        elif data.action == "restore":
            row.status = "active"
        elif row.repeat != "none":
            row.due_at = row.scheduled_at = next_occurrence(
                row.scheduled_at, row.repeat, row.timezone, utc_now()
            )
            row.status = "active"
        else:
            row.status = "done"
        return self.save(row)

    def remove(self, identifier: UUID, owner: UUID, revision: int) -> None:
        row = self.get(identifier, owner)
        self.check_revision(row, revision)
        row.status = "cancelled"
        self.save(row)

    def check_revision(self, row: DocumentReminder, revision: int) -> None:
        if row.revision != revision:
            raise ConflictError("This reminder changed. Refresh before trying again")

    def save(self, row: DocumentReminder) -> DocumentReminder:
        row.revision += 1
        self.db.commit()
        self.db.refresh(row)
        return row
