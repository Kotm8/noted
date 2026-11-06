from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.security import utc_now
from app.db.base import Base


class AssistantApplication(Base):
    __tablename__ = "ai_assistant_applications"
    id: Mapped[UUID] = mapped_column(primary_key=True)
    owner_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    fingerprint: Mapped[str] = mapped_column(String(64))
    result: Mapped[dict[str, Any]] = mapped_column(JSONB)


class AssistantChat(Base):
    """One conversation with the sidebar assistant, kept so it continues on any device."""

    __tablename__ = "ai_assistant_chats"
    __table_args__ = (Index("ix_ai_assistant_chats_owner_updated", "owner_id", "updated_at"),)
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    owner_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class AssistantTurn(Base):
    """A question, or the reply with any proposed changes, in an assistant chat."""

    __tablename__ = "ai_assistant_turns"
    __table_args__ = (Index("ix_ai_assistant_turns_chat_created", "chat_id", "created_at"),)
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    chat_id: Mapped[UUID] = mapped_column(ForeignKey("ai_assistant_chats.id", ondelete="CASCADE"))
    owner_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    role: Mapped[str] = mapped_column(String(16))
    content: Mapped[str] = mapped_column(Text)
    proposal: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    sources: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list)
    photo_ids: Mapped[list[str]] = mapped_column(JSONB, default=list)
    # The messages a question was asked about, so a reloaded chat still shows them.
    attached: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    applied: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class AiMemory(Base):
    """Something the assistant was told to remember about the owner, while memory is on."""

    __tablename__ = "ai_memories"
    __table_args__ = (Index("ix_ai_memories_owner_created", "owner_id", "created_at"),)
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    owner_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    text: Mapped[str] = mapped_column(String(300))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
