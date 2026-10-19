from uuid import UUID

from sqlalchemy import update
from sqlalchemy.orm import Session

from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.core.pagination import decode_message_cursor, encode_message_cursor
from app.core.security import utc_now
from app.notes.models import Message
from app.notes.repository import MessageRepository
from app.notes.schemas import MessageCreate, MessagePage, MessageResponse, MessageUpdate
from app.publishing.repository import complete_writing
from app.reminders.service import attach_reminder
from app.workspaces.services.channels import ChannelService


class MessageService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.repository = MessageRepository(db)
        self.channels = ChannelService(db)

    def get_message(self, message_id: UUID, owner_id: UUID, lock: bool = False) -> Message:
        message = self.repository.get_for_author(message_id, owner_id, lock)
        if message is None:
            raise NotFoundError("Note not found")
        self.channels.get_channel(message.channel_id, owner_id)
        return message

    def list_messages(
        self,
        channel_id: UUID,
        owner_id: UUID,
        limit: int,
        before: str | None,
        after: str | None = None,
        around: UUID | None = None,
    ) -> MessagePage:
        self.channels.get_channel(channel_id, owner_id)
        if sum(value is not None for value in (before, after, around)) > 1:
            raise ValidationError("Use one pagination direction at a time.")

        if after is not None:
            messages = self.repository.list_after(
                channel_id, decode_message_cursor(after), limit + 1
            )
            has_more = len(messages) > limit
            messages = messages[:limit]
            newer = (
                encode_message_cursor(messages[-1].created_at, messages[-1].id)
                if has_more
                else None
            )
            return MessagePage(
                items=self.responses(messages),
                next_cursor=None,
                newer_cursor=newer,
            )

        cursor = decode_message_cursor(before) if before is not None else None
        if around is not None:
            anchor = self.get_message(around, owner_id)
            if anchor.channel_id != channel_id or anchor.thread_root_id is not None:
                raise NotFoundError("Note not found in this channel")
            cursor = (anchor.created_at, anchor.id)
        messages = self.repository.list_for_channel(
            channel_id, limit + 1, cursor, around is not None
        )
        has_more = len(messages) > limit
        messages = messages[:limit]

        next_cursor = None
        if has_more:
            oldest_message = messages[-1]
            next_cursor = encode_message_cursor(oldest_message.created_at, oldest_message.id)

        return MessagePage(
            items=self.responses(list(reversed(messages))),
            next_cursor=next_cursor,
            newer_cursor=(
                encode_message_cursor(messages[0].created_at, messages[0].id)
                if messages and self.repository.has_newer(channel_id, messages[0])
                else None
            ),
        )

    def create_message(self, channel_id: UUID, data: MessageCreate, owner_id: UUID) -> Message:
        channel = self.channels.get_channel(channel_id, owner_id)
        if channel.kind == "journal":
            raise ValidationError("Create a journal entry in this channel.")
        if channel.kind == "document":
            raise ValidationError("Edit the Markdown page in this Notes channel.")
        message = self.repository.create(channel_id, owner_id, data.content)
        attach_reminder(self.db, message, data.reminder)
        complete_writing(self.db, channel_id, utc_now())
        self.db.commit()
        self.db.refresh(message)
        return message

    def update_message(self, message_id: UUID, data: MessageUpdate, owner_id: UUID) -> Message:
        message = self.get_message(message_id, owner_id, lock=True)
        if data.expected_content is not None and message.content != data.expected_content:
            raise ConflictError(
                "This note changed on another device. Reload it before trying again."
            )
        message.content = data.content
        message.updated_at = utc_now()
        self.db.commit()
        self.db.refresh(message)
        return message

    def delete_message(self, message_id: UUID, owner_id: UUID) -> None:
        message = self.get_message(message_id, owner_id, lock=True)
        message.deleted_at = utc_now()
        self.db.execute(
            update(Message)
            .where(Message.thread_root_id == message.id)
            .values(deleted_at=message.deleted_at)
        )
        self.db.commit()

    def responses(self, messages: list[Message]) -> list[MessageResponse]:
        counts = (
            self.repository.reply_counts([message.id for message in messages]) if messages else {}
        )
        return [
            MessageResponse.model_validate(message).model_copy(
                update={"reply_count": counts.get(message.id, 0)}
            )
            for message in messages
        ]
