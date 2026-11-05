import json
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from app.ai.models import AiRun
from app.ai.schemas import RunInput
from app.core.errors import NotFoundError, ValidationError
from app.journals.models import JournalEntry
from app.notes.mentions import readable
from app.workspaces.services.channels import ChannelService

INPUT_BUDGET = 150000


class InputTooLong(ValidationError):
    def __init__(self, characters: int) -> None:
        words = round(characters / 5 / 1000) * 1000
        super().__init__(
            f"This document is about {words:,} words, too long to send at once. "
            "Select the part you want help with."
        )


def writing_context(db: Session, owner_id: UUID, data: RunInput, kind: str) -> list[dict[str, Any]]:
    if data.place in ("journals", "documents"):
        if kind not in ("rewrite", "answer"):
            raise ValidationError("Writing supports Rewrite and Answer only.")
        if data.channel_id is None:
            raise ValidationError("Choose a channel first.")
        channel = ChannelService(db).get_channel(data.channel_id, owner_id)
        expected = "journal" if data.place == "journals" else "document"
        if channel.kind != expected:
            raise ValidationError("This channel does not match the writing surface.")
        if data.message_ids:
            raise ValidationError("Choose writing or messages, not both.")
    elif data.channel_id:
        ChannelService(db).get_channel(data.channel_id, owner_id)
    if data.conversation_id or data.history:
        if data.place != "documents" or kind != "answer" or data.conversation_id is None:
            raise ValidationError("Conversations are for answers about a document.")
        existing = db.query(AiRun).filter(AiRun.conversation_id == data.conversation_id).first()
        if existing and (existing.owner_id != owner_id or existing.channel_id != data.channel_id):
            raise NotFoundError("Conversation not found")
    if not data.entry_ids:
        return []
    if data.place != "journals" or kind != "answer" or data.message_ids:
        raise ValidationError("Look back is for answers across journal entries.")
    if len(set(data.entry_ids)) != len(data.entry_ids):
        raise ValidationError("Choose each entry once.")
    items: list[dict[str, Any]] = []
    for number, entry_id in enumerate(data.entry_ids, start=1):
        entry = db.get(JournalEntry, entry_id)
        if entry is None or entry.author_id != owner_id or entry.channel_id != data.channel_id:
            raise NotFoundError("A selected entry no longer exists in this journal.")
        items.append(
            {
                "number": number,
                "id": str(entry.id),
                "title": entry.title,
                "date": entry.created_at.isoformat(),
                "text": readable(entry.content),
            }
        )
    return items


def check_budget(*parts: Any) -> None:
    size = sum(
        len(part) if isinstance(part, str) else len(json.dumps(part, ensure_ascii=False))
        for part in parts
        if part is not None
    )
    if size > INPUT_BUDGET:
        raise InputTooLong(size)
