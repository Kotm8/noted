import uuid
from datetime import date, datetime

from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.security import utc_now
from app.db.base import Base


class PlanPrompt(Base):
    __tablename__ = "plan_prompts"
    __table_args__ = (
        UniqueConstraint("plan_id", "occurrence_date"),
        CheckConstraint("phase IN ('start', 'end')", name="ck_plan_prompt_phase"),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    plan_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schedule_plans.id", ondelete="CASCADE"))
    owner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    occurrence_date: Mapped[date] = mapped_column(Date)
    activity_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("activities.id"))
    title: Mapped[str] = mapped_column(String(120))
    planned_start: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    planned_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    phase: Mapped[str] = mapped_column(String(8), default="start", server_default="start")
    tracked_session_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("time_sessions.id", ondelete="SET NULL", name="fk_plan_prompt_tracked_session")
    )
    scheduled_notice_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    notify_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(16), default="pending")
    delayed: Mapped[bool] = mapped_column(default=False)
    revision: Mapped[int] = mapped_column(default=1)
    read_revision: Mapped[int] = mapped_column(default=0, server_default="0")
    last_request_id: Mapped[uuid.UUID | None]


class PlanPromptEvent(Base):
    __tablename__ = "plan_prompt_events"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    plan_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("schedule_plans.id", ondelete="CASCADE"), index=True
    )
    occurrence_date: Mapped[date] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    action: Mapped[str] = mapped_column(String(16))
    minutes: Mapped[int | None]
    reason: Mapped[str | None] = mapped_column(String(500))
    activity_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("activities.id", ondelete="SET NULL")
    )


class PlanPromptDelivery(Base):
    __tablename__ = "plan_prompt_deliveries"
    prompt_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("plan_prompts.id", ondelete="CASCADE"), primary_key=True
    )
    subscription_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("push_subscriptions.id", ondelete="CASCADE"), primary_key=True
    )
    revision: Mapped[int] = mapped_column(primary_key=True)
    attempts: Mapped[int] = mapped_column(default=0)
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    retry_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
