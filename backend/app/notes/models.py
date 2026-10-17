import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, Text, func, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.reminders.models import Reminder


class Attachment(Base):
    __tablename__ = "attachments"
    __table_args__ = (
        CheckConstraint("size >= 0", name="ck_attachments_size"),
        CheckConstraint("position >= 0", name="ck_attachments_position"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    message_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("messages.id", ondelete="CASCADE"), index=True
    )
    original_filename: Mapped[str] = mapped_column(String(255))
    storage_key: Mapped[str] = mapped_column(String(96), unique=True)
    content_type: Mapped[str] = mapped_column(String(100))
    size: Mapped[int]
    position: Mapped[int] = mapped_column(default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Message(Base):
    __tablename__ = "messages"
    __table_args__ = (
        CheckConstraint("length(content) BETWEEN 0 AND 40000", name="ck_messages_content_length"),
        Index("ix_messages_channel_cursor", "channel_id", "created_at", "id"),
        Index(
            "ix_messages_content_trgm",
            "content",
            postgresql_using="gin",
            postgresql_ops={"content": "public.gin_trgm_ops"},
            postgresql_where=text("deleted_at IS NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    channel_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("channels.id", ondelete="CASCADE"))
    author_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reminder: Mapped[Reminder | None] = relationship(
        lazy="selectin", cascade="all, delete-orphan", passive_deletes=True
    )
    attachments: Mapped[list["Attachment"]] = relationship(
        lazy="selectin",
        order_by="Attachment.position, Attachment.id",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
