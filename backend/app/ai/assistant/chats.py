"""Saved assistant conversations and the owner's opt-in memory.

Chats are stored on the server so a conversation continues after a reload or on another
device; the server, not the browser, decides what earlier turns the model sees.
"""

import json
from typing import Any
from uuid import UUID

from pydantic_ai import ModelRetry, Tool
from sqlalchemy import delete, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from app.ai.assistant.models import AiMemory, AssistantChat, AssistantTurn
from app.core.errors import NotFoundError, ValidationError
from app.core.security import utc_now

HISTORY_TURNS = 20
MAX_CHATS = 200
MAX_MEMORIES = 100
SEARCH_RESULTS = 8


def _title(question: str) -> str:
    line = " ".join(question.split())
    return line if len(line) <= 80 else line[:79].rstrip() + "…"


def chat_for(db: Session, owner_id: UUID, chat_id: UUID) -> AssistantChat:
    chat = db.get(AssistantChat, chat_id)
    if chat is None or chat.owner_id != owner_id:
        raise NotFoundError("This conversation was deleted.")
    return chat


def turns(db: Session, chat_id: UUID) -> list[AssistantTurn]:
    return list(
        db.scalars(
            select(AssistantTurn)
            .where(AssistantTurn.chat_id == chat_id)
            .order_by(AssistantTurn.created_at, AssistantTurn.id)
        )
    )


def as_history(rows: list[AssistantTurn]) -> list[dict[str, str]]:
    """Earlier turns in the shape the model reads, newest last."""
    history = []
    for row in rows[-HISTORY_TURNS:]:
        if row.role == "user":
            pictures = f"\n[{len(row.photo_ids)} picture(s) attached]" if row.photo_ids else ""
            about = (
                f"\n[Asked about {len(row.attached.get('message_ids', []))} attached message(s)"
                f" in #{row.attached.get('channel_name', '')}]"
                if row.attached
                else ""
            )
            history.append({"role": "user", "content": (row.content + pictures + about)[:40000]})
        else:
            reply = {**(row.proposal or {"explanation": row.content}), "applied": row.applied}
            history.append(
                {"role": "assistant", "content": json.dumps(reply, ensure_ascii=False)[:40000]}
            )
    return history


def history_for(db: Session, owner_id: UUID, chat_id: UUID | None) -> list[dict[str, str]]:
    if chat_id is None:
        return []
    return as_history(turns(db, chat_for(db, owner_id, chat_id).id))


def save_question(
    db: Session,
    owner_id: UUID,
    chat_id: UUID | None,
    question: str,
    photo_ids: list[UUID],
    attached: dict[str, Any] | None = None,
) -> AssistantChat:
    """Adds the question to its chat, creating one for a new conversation."""
    if chat_id is None:
        chat = AssistantChat(owner_id=owner_id, title=_title(question))
        db.add(chat)
        db.flush()
        stale = (
            select(AssistantChat.id)
            .where(AssistantChat.owner_id == owner_id)
            .order_by(AssistantChat.updated_at.desc())
            .offset(MAX_CHATS)
        )
        db.execute(delete(AssistantChat).where(AssistantChat.id.in_(stale)))
    else:
        chat = chat_for(db, owner_id, chat_id)
    db.add(
        AssistantTurn(
            chat_id=chat.id,
            owner_id=owner_id,
            role="user",
            content=question,
            photo_ids=[str(item) for item in photo_ids],
            attached=attached,
        )
    )
    chat.updated_at = utc_now()
    db.commit()
    return chat


def record_reply(engine: Engine, chat_id: UUID, owner_id: UUID, event: dict[str, Any]) -> UUID:
    output = event.get("output") or {}
    with Session(engine) as db:
        turn = AssistantTurn(
            chat_id=chat_id,
            owner_id=owner_id,
            role="assistant",
            content=str(output.get("explanation", "")),
            proposal=output,
            sources=event.get("sources") or [],
        )
        db.add(turn)
        chat = db.get(AssistantChat, chat_id)
        if chat is not None:
            chat.updated_at = utc_now()
        db.commit()
        return turn.id


def mark_applied(db: Session, owner_id: UUID, turn_id: UUID | None) -> None:
    if turn_id is None:
        return
    turn = db.get(AssistantTurn, turn_id)
    if turn is not None and turn.owner_id == owner_id:
        turn.applied = True


def chats(db: Session, owner_id: UUID, limit: int = 40) -> list[AssistantChat]:
    return list(
        db.scalars(
            select(AssistantChat)
            .where(AssistantChat.owner_id == owner_id)
            .order_by(AssistantChat.updated_at.desc())
            .limit(limit)
        )
    )


def delete_chat(db: Session, owner_id: UUID, chat_id: UUID) -> None:
    db.delete(chat_for(db, owner_id, chat_id))
    db.commit()


def memories(db: Session, owner_id: UUID) -> list[AiMemory]:
    return list(
        db.scalars(
            select(AiMemory).where(AiMemory.owner_id == owner_id).order_by(AiMemory.created_at)
        )
    )


def forget(db: Session, owner_id: UUID, memory_id: UUID | None = None) -> None:
    query = delete(AiMemory).where(AiMemory.owner_id == owner_id)
    if memory_id is not None:
        query = query.where(AiMemory.id == memory_id)
    db.execute(query)
    db.commit()


class AssistantTools:
    """Tools only the sidebar assistant has: earlier chats, and memory when it's on."""

    def __init__(self, engine: Engine, owner_id: UUID, chat_id: UUID | None, memory: bool):
        self.engine, self.owner_id, self.chat_id, self.memory = engine, owner_id, chat_id, memory

    def tools(self) -> list[Tool]:
        found = [
            Tool(
                self.search_chats,
                name="search_assistant_chats",
                takes_ctx=False,
                description="Search the owner's earlier conversations with you by keyword. "
                "Use it when they refer to something discussed before that isn't in this chat.",
            )
        ]
        if self.memory:
            found += [
                Tool(
                    self.remember,
                    name="remember",
                    takes_ctx=False,
                    description="Save one short, lasting fact or preference about the owner, "
                    "such as how they like answers or a routine they keep. "
                    "Not for one-off details.",
                ),
                Tool(
                    self.forget,
                    name="forget",
                    takes_ctx=False,
                    description="Delete a remembered fact by its id when the owner says it's "
                    "wrong or asks you to forget it.",
                ),
            ]
        return found

    def search_chats(self, query: str) -> list[dict[str, str]]:
        words = query.strip()
        if not words:
            raise ModelRetry("Give a keyword to search for.")
        with Session(self.engine) as db:
            pattern = (
                "%" + words.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
            )
            rows = db.execute(
                select(AssistantTurn, AssistantChat.title)
                .join(AssistantChat, AssistantChat.id == AssistantTurn.chat_id)
                .where(
                    AssistantTurn.owner_id == self.owner_id,
                    AssistantTurn.content.ilike(pattern, escape="\\"),
                    *([AssistantTurn.chat_id != self.chat_id] if self.chat_id else []),
                )
                .order_by(AssistantTurn.created_at.desc())
                .limit(SEARCH_RESULTS)
            ).all()
        return [
            {
                "chat": title,
                "date": turn.created_at.date().isoformat(),
                "who": "owner" if turn.role == "user" else "you",
                "text": turn.content[:600],
            }
            for turn, title in rows
        ]

    def remember(self, fact: str) -> str:
        text = " ".join(fact.split())[:300]
        if not text:
            raise ModelRetry("Write the fact to remember.")
        with Session(self.engine) as db:
            saved = memories(db, self.owner_id)
            if any(item.text.lower() == text.lower() for item in saved):
                return "Already remembered."
            if len(saved) >= MAX_MEMORIES:
                return "Memory is full. Ask the owner to remove some in Settings › AI."
            db.add(AiMemory(owner_id=self.owner_id, text=text))
            db.commit()
        return "Remembered."

    def forget(self, memory_id: str) -> str:
        try:
            identifier = UUID(memory_id)
        except ValueError:
            raise ModelRetry("Use an id from the remembered facts.") from None
        with Session(self.engine) as db:
            forget(db, self.owner_id, identifier)
        return "Forgotten."


def remembered(db: Session, owner_id: UUID, enabled: bool) -> str:
    """What memory adds to the standing note of every run while it's on; only the
    assistant can change it."""
    saved = memories(db, owner_id) if enabled else []
    if not saved:
        return ""
    listed = "\n".join(f"- {item.text}" for item in saved)
    return f"\n\nWhat you remember about the owner, to adapt to them:\n{listed}"


def memory_note(db: Session, owner_id: UUID) -> str:
    saved = memories(db, owner_id)
    if not saved:
        return "You don't remember anything about the owner yet."
    listed = "\n".join(f"- [{item.id}] {item.text}" for item in saved)
    return f"What you remember about the owner (ids in brackets):\n{listed}"


def check_photos(db: Session, owner_id: UUID, photo_ids: list[UUID]) -> list[tuple[UUID, str]]:
    from app.nutrition.service import NutritionService

    if len(set(photo_ids)) != len(photo_ids):
        raise ValidationError("Attach each picture once.")
    service = NutritionService(db)
    return [
        (photo.id, photo.storage_key)
        for photo in (service.photo(owner_id, photo_id) for photo_id in photo_ids)
    ]


def finish_reply(
    engine: Engine,
    owner_id: UUID,
    numbered: dict[int, UUID],
    reply_to: UUID | None,
    output: dict[str, Any],
) -> dict[str, Any]:
    """Turns rewrite numbers into message ids, and posts a reply in its thread right away:
    the owner asked for it, so it doesn't wait for review. Deleting it is the undo."""
    from app.notes.schemas import MessageCreate
    from app.threads.service import ThreadService

    finished = {**output}
    finished["rewrites"] = [
        {"id": str(numbered[item["number"]]), "text": item["text"]}
        for item in output.get("rewrites") or []
        if item.get("number") in numbered
    ]
    reply = (output.get("reply") or "").strip()
    if reply and reply_to is not None:
        with Session(engine) as db:
            message = ThreadService(db).reply(reply_to, owner_id, MessageCreate(content=reply))
            message.ai_generated = True
            db.commit()
            finished["posted"] = {
                "message_id": str(message.id),
                "thread_root_id": str(reply_to),
                "channel_id": str(message.channel_id),
            }
    return finished
