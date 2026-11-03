from datetime import datetime
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class WatchSyncState(Base):
    __tablename__ = "watch_sync_state"

    subscription_id: Mapped[UUID] = mapped_column(
        ForeignKey("push_subscriptions.id", ondelete="CASCADE"), primary_key=True
    )
    requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
