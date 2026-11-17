from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.ai.assistant.chats import MAX_MEMORIES
from app.ai.assistant.models import AiMemory, AssistantChat, AssistantTurn
from app.ai.models import AiRun
from app.core.errors import ValidationError
from app.nutrition.models import MealPhoto

ASSISTANT_VERSION = 12


def assistant_queries(owner_id: UUID) -> dict[str, Any]:
    return {
        "writing_runs": select(AiRun.__table__)
        .where(AiRun.owner_id == owner_id)
        .order_by(AiRun.created_at, AiRun.id),
        "assistant_chats": select(AssistantChat.__table__)
        .where(AssistantChat.owner_id == owner_id)
        .order_by(AssistantChat.updated_at.desc()),
        "assistant_turns": select(AssistantTurn.__table__)
        .where(AssistantTurn.owner_id == owner_id)
        .order_by(AssistantTurn.created_at, AssistantTurn.id),
        "ai_memories": select(AiMemory.__table__)
        .where(AiMemory.owner_id == owner_id)
        .order_by(AiMemory.created_at),
    }


def assistant_document(rows: dict[str, list[dict[str, Any]]]) -> dict[str, Any] | None:
    if not rows["assistant_chats"] and not rows["ai_memories"] and not rows["writing_runs"]:
        return None
    turns: dict[UUID, list[dict[str, Any]]] = {}
    for row in rows["assistant_turns"]:
        turns.setdefault(row["chat_id"], []).append(
            {
                key: row[key]
                for key in (
                    "role",
                    "content",
                    "proposal",
                    "sources",
                    "applied",
                    "created_at",
                    "photo_ids",
                    "attached",
                )
            }
        )
    return {
        "writing_runs": [
            {key: value for key, value in row.items() if key != "owner_id"}
            for row in rows["writing_runs"]
        ],
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
    if data.writing_runs:
        if data.version < 16 or len({run.id for run in data.writing_runs}) != len(
            data.writing_runs
        ):
            raise ValidationError("Writing history needs a format 16 backup with distinct run IDs.")
    if not data.assistant_chats and not data.ai_memories:
        return
    if data.version < ASSISTANT_VERSION:
        raise ValidationError("Assistant chats require a version 12 backup.")
    if len(data.ai_memories) > MAX_MEMORIES:
        raise ValidationError(f"A backup can hold up to {MAX_MEMORIES} memories.")
    ids = [chat.id for chat in data.assistant_chats]
    if len(set(ids)) != len(ids):
        raise ValidationError("The backup contains duplicate assistant chats.")


def restore_assistant(
    db: Session,
    owner_id: UUID,
    data: Any,
    replace: bool,
    identifiers: dict[UUID, UUID],
    keys: dict[str, str],
) -> None:
    """Chats are added alongside existing ones; memories already remembered aren't repeated."""
    if not replace and not data.assistant_chats and not data.ai_memories and not data.writing_runs:
        return
    if replace:
        db.execute(delete(AiRun).where(AiRun.owner_id == owner_id))
        db.execute(delete(AssistantChat).where(AssistantChat.owner_id == owner_id))
        db.execute(delete(AiMemory).where(AiMemory.owner_id == owner_id))
        db.flush()
    for run in data.writing_runs:
        if run.conversation_id is not None:
            identifiers.setdefault(run.conversation_id, uuid4())
        interrupted = run.outcome == "running"
        db.add(
            AiRun(
                **run.model_dump(
                    exclude={
                        "id",
                        "channel_id",
                        "conversation_id",
                        "input",
                        "output",
                        "outcome",
                        "error",
                    }
                ),
                id=uuid4(),
                owner_id=owner_id,
                channel_id=identifiers.get(run.channel_id) if run.channel_id else None,
                conversation_id=identifiers.get(run.conversation_id)
                if run.conversation_id
                else None,
                input=remap(run.input, identifiers),
                output=remap(run.output, identifiers),
                outcome="failed" if interrupted else run.outcome,
                error="This request was running when the backup was made."
                if interrupted
                else run.error,
            )
        )
    for photo in data.assistant_photos:
        db.add(
            MealPhoto(
                id=identifiers[photo.id],
                owner_id=owner_id,
                meal_id=None,
                storage_key=keys[photo.file.path],
                size=photo.file.size,
                width=photo.width,
                height=photo.height,
                created_at=photo.created_at,
            )
        )
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
                    photo_ids=[str(identifiers[item]) for item in turn.photo_ids],
                    **{
                        **turn.model_dump(exclude={"photo_ids", "attached"}),
                        "attached": remap(turn.attached, identifiers),
                        "sources": remap(turn.sources, identifiers),
                        "proposal": remap(turn.proposal, identifiers),
                    },
                )
            )
    known = {
        text.lower()
        for text in db.scalars(select(AiMemory.text).where(AiMemory.owner_id == owner_id))
    }
    for memory in data.ai_memories:
        if memory.text.lower() in known:
            continue
        if len(known) >= MAX_MEMORIES:
            raise ValidationError(
                "Import would exceed AI memory capacity. "
                "Use Replace to restore the source memories."
            )
        known.add(memory.text.lower())
        db.add(AiMemory(owner_id=owner_id, text=memory.text, created_at=memory.created_at))
    db.flush()


def remap(value: Any, identifiers: dict[UUID, UUID]) -> Any:
    if isinstance(value, dict):
        return {key: remap(item, identifiers) for key, item in value.items()}
    if isinstance(value, list):
        return [remap(item, identifiers) for item in value]
    if isinstance(value, str):
        try:
            identifier = UUID(value)
        except ValueError:
            return value
        return str(identifiers.get(identifier, identifier))
    return value
