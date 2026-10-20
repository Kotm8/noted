from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class WatchPairing(Base):
    __tablename__ = "watch_pairings"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    ticket_hash: Mapped[str] = mapped_column(String(64), unique=True)
    session_id: Mapped[UUID] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)


class WatchDevice(Base):
    __tablename__ = "watch_devices"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    session_id: Mapped[UUID] = mapped_column(
        ForeignKey("sessions.id", ondelete="CASCADE"), unique=True
    )
    secret_hash: Mapped[str] = mapped_column(String(64), unique=True)
