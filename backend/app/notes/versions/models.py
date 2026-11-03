import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class MessageVersion(Base):
    """An earlier text of a message, kept when an edit replaces it."""

    __tablename__ = "message_versions"
    __table_args__ = (Index("ix_message_versions_message", "message_id", "replaced_at"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    message_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("messages.id", ondelete="CASCADE"))
    content: Mapped[str] = mapped_column(Text)
    written_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    replaced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
