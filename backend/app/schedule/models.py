import uuid
from datetime import date as calendar_date
from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, Date, DateTime, ForeignKey, Index, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class SchedulePlan(Base):
    __tablename__ = "schedule_plans"
    __table_args__ = (
        CheckConstraint("start_minute >= 0 AND end_minute <= 1440 AND end_minute > start_minute"),
        CheckConstraint("frequency IN ('none', 'daily', 'weekly', 'biweekly', 'monthly')"),
        Index("ix_schedule_owner_date", "owner_id", "date"),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    activity_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("activities.id"))
    title: Mapped[str] = mapped_column(String(120))
    date: Mapped[calendar_date] = mapped_column(Date)
    start_minute: Mapped[int]
    end_minute: Mapped[int]
    timezone: Mapped[str] = mapped_column(String(64))
    notifications_enabled: Mapped[bool] = mapped_column(default=True)
    notification_minutes: Mapped[int | None]
    frequency: Mapped[str] = mapped_column(String(16), default="none")
    weekdays: Mapped[list[int]] = mapped_column(JSONB, default=list)
    repeat_until: Mapped[calendar_date | None] = mapped_column(Date)
    revision: Mapped[int] = mapped_column(default=1)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ScheduleException(Base):
    __tablename__ = "schedule_exceptions"
    __table_args__ = (
        CheckConstraint("start_minute >= 0 AND end_minute <= 1440 AND end_minute > start_minute"),
    )
    plan_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("schedule_plans.id", ondelete="CASCADE"), primary_key=True
    )
    occurrence_date: Mapped[calendar_date] = mapped_column(Date, primary_key=True)
    activity_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("activities.id"))
    title: Mapped[str] = mapped_column(String(120))
    date: Mapped[calendar_date] = mapped_column(Date)
    start_minute: Mapped[int]
    end_minute: Mapped[int]
    timezone: Mapped[str] = mapped_column(String(64))
    notifications_enabled: Mapped[bool] = mapped_column(default=True)
    notification_minutes: Mapped[int | None]
    deleted: Mapped[bool] = mapped_column(Boolean, default=False)
