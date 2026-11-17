from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.notifications.models import DeliveryProgress


class DocumentReminder(Base):
    __tablename__ = "document_reminders"
    __table_args__ = (
        CheckConstraint("repeat IN ('none', 'daily', 'weekdays', 'weekly')"),
        CheckConstraint("status IN ('active', 'done', 'cancelled')"),
        CheckConstraint("revision > 0"),
        CheckConstraint("length(name) BETWEEN 1 AND 500"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    channel_id: Mapped[UUID] = mapped_column(
        ForeignKey("channels.id", ondelete="CASCADE"), index=True
    )
    owner_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(500))
    due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    scheduled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    timezone: Mapped[str] = mapped_column(String(64), default="UTC")
    repeat: Mapped[str] = mapped_column(String(16), default="none")
    urgent: Mapped[bool] = mapped_column(default=False)
    status: Mapped[str] = mapped_column(String(16), default="active")
    revision: Mapped[int] = mapped_column(default=1)
    read_revision: Mapped[int] = mapped_column(default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class DocumentReminderDelivery(DeliveryProgress, Base):
    __tablename__ = "document_reminder_deliveries"
    item_key = "reminder_id"
    reminder_id: Mapped[UUID] = mapped_column(
        ForeignKey("document_reminders.id", ondelete="CASCADE"), primary_key=True
    )
