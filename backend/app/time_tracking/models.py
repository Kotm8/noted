import uuid
from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, String, func, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Activity(Base):
    __tablename__ = "activities"
    __table_args__ = (
        Index("uq_activity_name", "owner_id", func.lower(text("name")), unique=True),
        CheckConstraint("position >= 0"),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(60))
    icon: Mapped[str] = mapped_column(String(32), default="Activity")
    color: Mapped[str] = mapped_column(String(7), default="#e2c15a")
    position: Mapped[int] = mapped_column(default=0)
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    revision: Mapped[int] = mapped_column(default=1)


class TimeSession(Base):
    __tablename__ = "time_sessions"
    __table_args__ = (
        CheckConstraint("ended_at IS NULL OR ended_at > started_at"),
        Index("ix_time_sessions_cursor", "owner_id", "started_at", "id"),
        Index(
            "uq_active_time_session",
            "owner_id",
            unique=True,
            postgresql_where=text("ended_at IS NULL"),
        ),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    activity_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("activities.id"))
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revision: Mapped[int] = mapped_column(default=1)


class TrackerState(Base):
    __tablename__ = "tracker_state"
    __table_args__ = (
        CheckConstraint(
            "start_minute >= 0 AND end_minute <= 1440 AND end_minute - start_minute >= 60"
        ),
    )
    owner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    revision: Mapped[int] = mapped_column(default=1)
    last_request_id: Mapped[uuid.UUID | None] = mapped_column()
    paused_activity_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("activities.id"))
    elapsed_seconds: Mapped[int] = mapped_column(default=0)
    start_minute: Mapped[int] = mapped_column(default=480)
    end_minute: Mapped[int] = mapped_column(default=1320)
    timezone: Mapped[str] = mapped_column(String(64), default="UTC")
