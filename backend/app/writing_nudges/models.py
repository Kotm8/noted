import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.notifications.models import DeliveryProgress


class WritingNudgeRun(Base):
    __tablename__ = "writing_nudge_runs"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), unique=True
    )
    activity_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("activities.id", ondelete="CASCADE"))
    channel_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("channels.id", ondelete="CASCADE"))
    settings: Mapped[dict[str, Any]] = mapped_column(JSONB)
    remaining_seconds: Mapped[float]
    tracked_seconds: Mapped[float] = mapped_column(default=0)
    resumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    next_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)


class WritingNudge(Base):
    __tablename__ = "writing_nudges"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    channel_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("channels.id", ondelete="CASCADE"), index=True
    )
    content: Mapped[str] = mapped_column(String(500))
    due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revision: Mapped[int] = mapped_column(default=1)
    read_revision: Mapped[int] = mapped_column(default=0)


class NudgeDelivery(DeliveryProgress, Base):
    __tablename__ = "writing_nudge_deliveries"
    item_key = "nudge_id"
    nudge_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("writing_nudges.id", ondelete="CASCADE"), primary_key=True
    )
