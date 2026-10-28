import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.notifications.models import DeliveryProgress


class ScheduledMessage(Base):
    __tablename__ = "scheduled_messages"
    __table_args__ = (
        CheckConstraint("status IN ('pending', 'sent', 'skipped', 'cancelled')"),
        CheckConstraint("length(content) BETWEEN 1 AND 40000"),
        Index("ix_scheduled_messages_due", "status", "send_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    channel_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("channels.id", ondelete="CASCADE"), index=True
    )
    content: Mapped[str] = mapped_column(Text)
    send_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    timezone: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(16), default="pending")
    revision: Mapped[int] = mapped_column(default=1)
    message_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("messages.id", ondelete="SET NULL"), unique=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class WritingPrompt(Base):
    __tablename__ = "writing_prompts"
    __table_args__ = (
        CheckConstraint("frequency IN ('daily', 'weekly', 'biweekly', 'monthly')"),
        Index("ix_writing_prompts_next", "enabled", "next_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    channel_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("channels.id", ondelete="CASCADE"), unique=True
    )
    content: Mapped[str] = mapped_column(String(500))
    start_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    timezone: Mapped[str] = mapped_column(String(64))
    frequency: Mapped[str] = mapped_column(String(16))
    weekdays: Mapped[list[int]] = mapped_column(JSONB, default=list)
    enabled: Mapped[bool] = mapped_column(default=True)
    next_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revision: Mapped[int] = mapped_column(default=1)
    read_revision: Mapped[int] = mapped_column(default=0)


class WritingDelivery(DeliveryProgress, Base):
    __tablename__ = "writing_deliveries"
    item_key = "prompt_id"
    prompt_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("writing_prompts.id", ondelete="CASCADE"), primary_key=True
    )
