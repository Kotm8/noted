from datetime import timedelta
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.core.security import utc_now
from app.publishing.models import ScheduledMessage, WritingPrompt
from app.publishing.recurrence import next_occurrence
from app.publishing.repository import PublishingRepository
from app.publishing.schemas import ScheduledFields, ScheduledUpdate, WritingUpdate
from app.workspaces.services.channels import ChannelService


class PublishingService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.channels = ChannelService(db)
        self.repository = PublishingRepository(db)

    def list_messages(self, channel_id: UUID, owner_id: UUID) -> list[ScheduledMessage]:
        self.channels.get_channel(channel_id, owner_id)
        return self.repository.messages(channel_id)

    def create(self, channel_id: UUID, owner_id: UUID, data: ScheduledFields) -> ScheduledMessage:
        channel = self.channels.get_channel(channel_id, owner_id)
        self.db.refresh(channel, with_for_update=True)
        if channel.kind != "note":
            raise ValidationError("Scheduled messages are available in chat channels.")
        self.check_time(data)
        count = (
            self.db.scalar(
                select(func.count())
                .select_from(ScheduledMessage)
                .where(
                    ScheduledMessage.channel_id == channel_id, ScheduledMessage.status == "pending"
                )
            )
            or 0
        )
        if count >= 100:
            raise ValidationError("This channel already has 100 scheduled messages.")
        message = ScheduledMessage(owner_id=owner_id, channel_id=channel_id, **data.model_dump())
        self.db.add(message)
        self.db.commit()
        self.db.refresh(message)
        return message

    def get_message(self, message_id: UUID, owner_id: UUID, revision: int) -> ScheduledMessage:
        message = self.db.scalar(
            select(ScheduledMessage)
            .where(ScheduledMessage.id == message_id, ScheduledMessage.owner_id == owner_id)
            .with_for_update()
        )
        if message is None:
            raise NotFoundError("Scheduled message not found")
        if message.status != "pending" or message.revision != revision:
            raise ConflictError("This scheduled message changed. Refresh the queue.")
        return message

    def update(self, message_id: UUID, owner_id: UUID, data: ScheduledUpdate) -> ScheduledMessage:
        message = self.get_message(message_id, owner_id, data.revision)
        self.check_time(data)
        for key, value in data.model_dump(exclude={"revision"}).items():
            setattr(message, key, value)
        message.revision += 1
        self.db.commit()
        self.db.refresh(message)
        return message

    def cancel(self, message_id: UUID, owner_id: UUID, revision: int) -> None:
        message = self.get_message(message_id, owner_id, revision)
        message.status = "cancelled"
        message.revision += 1
        self.db.commit()

    def writing(self, channel_id: UUID, owner_id: UUID) -> WritingPrompt | None:
        self.channels.get_channel(channel_id, owner_id)
        return self.repository.prompt(channel_id)

    def save_writing(self, channel_id: UUID, owner_id: UUID, data: WritingUpdate) -> WritingPrompt:
        channel = self.channels.get_channel(channel_id, owner_id)
        self.db.refresh(channel, with_for_update=True)
        prompt = self.repository.prompt(channel_id, lock=True)
        if (prompt.revision if prompt else 0) != data.revision:
            raise ConflictError("This writing prompt changed. Reload before saving.")
        if prompt is None:
            prompt = WritingPrompt(owner_id=owner_id, channel_id=channel_id)
            self.db.add(prompt)
        for key, value in data.model_dump(exclude={"revision"}).items():
            setattr(prompt, key, value)
        prompt.next_at = next_occurrence(prompt, utc_now() - timedelta(microseconds=1))
        prompt.due_at = None
        prompt.revision = data.revision + 1
        self.db.commit()
        self.db.refresh(prompt)
        return prompt

    def dismiss(self, channel_id: UUID, owner_id: UUID, revision: int) -> None:
        self.channels.get_channel(channel_id, owner_id)
        prompt = self.repository.prompt(channel_id, lock=True)
        if prompt is None:
            raise NotFoundError("Writing prompt not found")
        if prompt.revision != revision:
            raise ConflictError("This writing prompt changed. Refresh before dismissing.")
        prompt.due_at = None
        self.db.commit()

    @staticmethod
    def check_time(data: ScheduledFields) -> None:
        if data.send_at <= utc_now():
            raise ValidationError("Choose a time in the future.")
        if data.send_at > utc_now() + timedelta(days=366 * 5):
            raise ValidationError("Schedule messages within the next five years.")
