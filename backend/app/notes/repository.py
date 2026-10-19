from datetime import datetime
from uuid import UUID

from sqlalchemy import func, select, tuple_
from sqlalchemy.orm import Session

from app.notes.models import Attachment, Message


class MessageRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get_for_author(
        self, message_id: UUID, author_id: UUID, lock: bool = False
    ) -> Message | None:
        statement = select(Message).where(
            Message.id == message_id,
            Message.author_id == author_id,
            Message.deleted_at.is_(None),
        )
        return self.db.scalar(statement.with_for_update(of=Message) if lock else statement)

    def list_for_channel(
        self,
        channel_id: UUID,
        limit: int,
        before: tuple[datetime, UUID] | None,
        include_boundary: bool = False,
    ) -> list[Message]:
        statement = select(Message).where(
            Message.channel_id == channel_id,
            Message.thread_root_id.is_(None),
            Message.deleted_at.is_(None),
        )
        if before is not None:
            position = tuple_(Message.created_at, Message.id)
            statement = statement.where(
                position <= before if include_boundary else position < before
            )

        statement = statement.order_by(Message.created_at.desc(), Message.id.desc()).limit(limit)
        return list(self.db.scalars(statement))

    def list_after(
        self, channel_id: UUID, after: tuple[datetime, UUID], limit: int
    ) -> list[Message]:
        statement = (
            select(Message)
            .where(
                Message.channel_id == channel_id,
                Message.thread_root_id.is_(None),
                Message.deleted_at.is_(None),
                tuple_(Message.created_at, Message.id) > after,
            )
            .order_by(Message.created_at, Message.id)
            .limit(limit)
        )
        return list(self.db.scalars(statement))

    def has_newer(self, channel_id: UUID, message: Message) -> bool:
        statement = (
            select(Message.id)
            .where(
                Message.channel_id == channel_id,
                Message.thread_root_id.is_(None),
                Message.deleted_at.is_(None),
                tuple_(Message.created_at, Message.id) > (message.created_at, message.id),
            )
            .limit(1)
        )
        return self.db.scalar(statement) is not None

    def reply_counts(self, identifiers: list[UUID]) -> dict[UUID, int]:
        statement = (
            select(Message.thread_root_id, func.count())
            .where(Message.thread_root_id.in_(identifiers), Message.deleted_at.is_(None))
            .group_by(Message.thread_root_id)
        )
        return {root: count for root, count in self.db.execute(statement) if root is not None}

    def create(
        self, channel_id: UUID, author_id: UUID, content: str, thread_root_id: UUID | None = None
    ) -> Message:
        message = Message(
            channel_id=channel_id,
            author_id=author_id,
            content=content,
            thread_root_id=thread_root_id,
        )
        self.db.add(message)
        self.db.flush()
        return message


class AttachmentRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get_by_id(self, attachment_id: UUID) -> Attachment | None:
        return self.db.get(Attachment, attachment_id)

    def create(
        self,
        message_id: UUID,
        filename: str,
        storage_key: str,
        content_type: str,
        size: int,
        position: int,
    ) -> Attachment:
        attachment = Attachment(
            message_id=message_id,
            original_filename=filename,
            storage_key=storage_key,
            content_type=content_type,
            size=size,
            position=position,
        )
        self.db.add(attachment)
        self.db.flush()
        return attachment
