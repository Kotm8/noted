import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.security import utc_now
from app.db.base import Base

KINDS = ("rewrite", "reply", "draft", "answer")
PLACES = ("messages", "journals", "documents", "composer")


class AiPrompt(Base):
    """A saved prompt: plain-words instructions plus what it returns and where it shows up."""

    __tablename__ = "ai_prompts"
    __table_args__ = (
        CheckConstraint(
            "kind IN ('rewrite', 'reply', 'draft', 'answer')", name="ck_ai_prompt_kind"
        ),
        CheckConstraint("sees IN ('selection', 'channel_today')", name="ck_ai_prompt_sees"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(60))
    instructions: Mapped[str] = mapped_column(Text)
    kind: Mapped[str] = mapped_column(String(16))
    places: Mapped[list[str]] = mapped_column(JSONB, default=list)
    sees: Mapped[str] = mapped_column(String(16), default="selection")
    model: Mapped[str | None] = mapped_column(String(80))
    position: Mapped[int] = mapped_column(default=0)
    revision: Mapped[int] = mapped_column(default=1)


class AiRun(Base):
    """One request to the AI and what became of it, for Settings › AI › History."""

    __tablename__ = "ai_runs"
    __table_args__ = (
        Index("ix_ai_runs_owner_created", "owner_id", "created_at"),
        Index("ix_ai_runs_owner_conversation_created", "owner_id", "conversation_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    conversation_id: Mapped[uuid.UUID | None] = mapped_column()
    prompt_name: Mapped[str] = mapped_column(String(80))
    instructions: Mapped[str] = mapped_column(Text)
    kind: Mapped[str] = mapped_column(String(16))
    place: Mapped[str] = mapped_column(String(16))
    channel_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("channels.id", ondelete="SET NULL")
    )
    where: Mapped[str] = mapped_column(String(200))
    model: Mapped[str] = mapped_column(String(80))
    # What was sent and what came back, so History can show the before and after.
    input: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list)
    output: Mapped[Any] = mapped_column(JSONB, default=None)
    outcome: Mapped[str] = mapped_column(String(16), default="running")
    error: Mapped[str | None] = mapped_column(Text)
    usage: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
