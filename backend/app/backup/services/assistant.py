"""Assistant chats and memories in portable backups.

Pictures attached in a chat aren't kept: like unsaved meal photos they're removed after a
day, and a picture that was logged with a meal travels with that meal instead.
"""

from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.ai.assistant.chats import MAX_CHATS, MAX_MEMORIES
from app.ai.assistant.models import AiMemory, AssistantChat, AssistantTurn
from app.core.errors import ValidationError

ASSISTANT_VERSION = 12


def assistant_queries(owner_id: UUID) -> dict[str, Any]:
    return {
        "assistant_chats": select(AssistantChat.__table__)
        .where(AssistantChat.owner_id == owner_id)
        .order_by(AssistantChat.updated_at.desc())
        .limit(MAX_CHATS),
        "assistant_turns": select(AssistantTurn.__table__)
        .where(AssistantTurn.owner_id == owner_id)
        .order_by(AssistantTurn.created_at, AssistantTurn.id),
        "ai_memories": select(AiMemory.__table__)
        .where(AiMemory.owner_id == owner_id)
        .order_by(AiMemory.created_at),
    }


def assistant_document(rows: dict[str, list[dict[str, Any]]]) -> dict[str, Any] | None:
    if not rows["assistant_chats"] and not rows["ai_memories"]:
        return None
    turns: dict[UUID, list[dict[str, Any]]] = {}
    for row in rows["assistant_turns"]:
        turns.setdefault(row["chat_id"], []).append(
            {
                key: row[key]
                for key in ("role", "content", "proposal", "sources", "applied", "created_at")
            }
        )
    return {
        "assistant_chats": [
            {
                **{key: row[key] for key in ("id", "title", "created_at", "updated_at")},
                "turns": turns.get(row["id"], []),
            }
            for row in rows["assistant_chats"]
        ],
        "ai_memories": [
            {key: row[key] for key in ("text", "created_at")} for row in rows["ai_memories"]
        ],
    }


def validate_assistant(data: Any) -> None:
    if not data.assistant_chats and not data.ai_memories:
        return
    if data.version < ASSISTANT_VERSION:
        raise ValidationError("Assistant chats require a version 12 backup.")
    if len(data.assistant_chats) > MAX_CHATS:
        raise ValidationError(f"A backup can hold up to {MAX_CHATS} assistant chats.")
    if len(data.ai_memories) > MAX_MEMORIES:
        raise ValidationError(f"A backup can hold up to {MAX_MEMORIES} memories.")
    ids = [chat.id for chat in data.assistant_chats]
    if len(set(ids)) != len(ids):
        raise ValidationError("The backup contains duplicate assistant chats.")


def restore_assistant(db: Session, owner_id: UUID, data: Any, replace: bool) -> None:
    """Chats are added alongside existing ones; memories already remembered aren't repeated."""
    if not data.assistant_chats and not data.ai_memories:
        return
    if replace:
        db.execute(delete(AssistantChat).where(AssistantChat.owner_id == owner_id))
        db.execute(delete(AiMemory).where(AiMemory.owner_id == owner_id))
        db.flush()
    for chat in data.assistant_chats:
        chat_id = uuid4()
        db.add(
            AssistantChat(
                id=chat_id,
                owner_id=owner_id,
                title=chat.title,
                created_at=chat.created_at,
                updated_at=chat.updated_at,
            )
        )
        db.flush()
        for turn in chat.turns:
            db.add(
                AssistantTurn(
                    chat_id=chat_id,
                    owner_id=owner_id,
                    photo_ids=[],
                    **turn.model_dump(),
                )
            )
    known = {
        text.lower()
        for text in db.scalars(select(AiMemory.text).where(AiMemory.owner_id == owner_id))
    }
    for memory in data.ai_memories:
        if memory.text.lower() in known or len(known) >= MAX_MEMORIES:
            continue
        known.add(memory.text.lower())
        db.add(AiMemory(owner_id=owner_id, text=memory.text, created_at=memory.created_at))
    db.flush()
