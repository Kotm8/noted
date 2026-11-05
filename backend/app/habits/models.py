import uuid
from datetime import date, datetime

from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, Index, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.notifications.models import DeliveryProgress


class Habit(Base):
    __tablename__ = "habits"
    __table_args__ = (
        CheckConstraint("goal > 0 AND goal <= 100000"),
        CheckConstraint("kind IN ('check', 'count', 'time')"),
        CheckConstraint("period IN ('Morning', 'Anytime', 'Evening')"),
        Index("ix_habits_owner", "owner_id"),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(60))
    kind: Mapped[str] = mapped_column(String(8))
    goal: Mapped[float]
    unit: Mapped[str] = mapped_column(String(20))
    period: Mapped[str] = mapped_column(String(8))
    weekdays: Mapped[list[int]] = mapped_column(JSONB)
    activity_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("activities.id"))
    timezone: Mapped[str] = mapped_column(String(64))
    starts_on: Mapped[date] = mapped_column(Date)
    reminder_start: Mapped[date | None] = mapped_column(Date)
    reminder_minute: Mapped[int | None]
    next_reminder_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    revision: Mapped[int] = mapped_column(default=1)
    archived: Mapped[bool] = mapped_column(default=False)


class HabitEntry(Base):
    __tablename__ = "habit_entries"
    habit_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("habits.id", ondelete="CASCADE"), primary_key=True
    )
    day: Mapped[date] = mapped_column(Date, primary_key=True)
    value: Mapped[float]
    revision: Mapped[int] = mapped_column(default=1)


class HabitReminder(Base):
    __tablename__ = "habit_reminders"
    __table_args__ = (Index("uq_habit_reminder_day", "habit_id", "day", unique=True),)
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    habit_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("habits.id", ondelete="CASCADE"))
    day: Mapped[date] = mapped_column(Date)
    due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    read_revision: Mapped[int] = mapped_column(default=0)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revision: Mapped[int] = mapped_column(default=1)


class HabitDelivery(DeliveryProgress, Base):
    __tablename__ = "habit_deliveries"
    item_key = "reminder_id"
    reminder_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("habit_reminders.id", ondelete="CASCADE"), primary_key=True
    )
