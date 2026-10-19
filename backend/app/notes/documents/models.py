from datetime import datetime
from uuid import UUID

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ChannelDocument(Base):
    __tablename__ = "channel_documents"
    __table_args__ = (
        CheckConstraint("revision > 0", name="ck_document_revision"),
        CheckConstraint("length(content) <= 200000", name="ck_document_content"),
        Index(
            "ix_document_content_trgm",
            "content",
            postgresql_using="gin",
            postgresql_ops={"content": "public.gin_trgm_ops"},
        ),
    )

    channel_id: Mapped[UUID] = mapped_column(
        ForeignKey("channels.id", ondelete="CASCADE"), primary_key=True
    )
    content: Mapped[str] = mapped_column(Text, default="")
    revision: Mapped[int] = mapped_column(default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
