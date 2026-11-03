import re
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import NotFoundError
from app.core.security import utc_now
from app.notes.models import Message
from app.notes.versions.models import MessageVersion

CHECKBOX = re.compile(r"\[[ xX]\]")
LIMIT = 100


def only_checkboxes_changed(before: str, after: str) -> bool:
    """Ticking a checklist item saves the message too; those saves aren't edits."""
    return before != after and CHECKBOX.sub("[ ]", before) == CHECKBOX.sub("[ ]", after)


def keep_version(db: Session, message: Message, content: str) -> None:
    """Saves the text an edit is about to replace, unless it's unchanged or only ticked."""
    if content == message.content or only_checkboxes_changed(message.content, content):
        return
    db.add(
        MessageVersion(
            message_id=message.id,
            content=message.content,
            written_at=message.updated_at,
            replaced_at=utc_now(),
        )
    )


def versions(db: Session, message_id: UUID) -> list[MessageVersion]:
    return list(
        db.scalars(
            select(MessageVersion)
            .where(MessageVersion.message_id == message_id)
            .order_by(MessageVersion.replaced_at.desc(), MessageVersion.id)
            .limit(LIMIT)
        )
    )


def version(db: Session, message_id: UUID, version_id: UUID) -> MessageVersion:
    found = db.get(MessageVersion, version_id)
    if found is None or found.message_id != message_id:
        raise NotFoundError("This version is no longer available")
    return found
