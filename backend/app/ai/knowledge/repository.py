from typing import Any
from urllib.parse import urlencode
from uuid import UUID

from sqlalchemy.orm import Session

from app.ai.knowledge.schemas import IMAGE_TYPES, NoteKind, NoteSource
from app.core.errors import NotFoundError
from app.journals.models import JournalEntry
from app.notes.documents.models import ChannelDocument
from app.notes.mentions import readable
from app.notes.services.messages import MessageService
from app.workspaces.models import Workspace
from app.workspaces.services.channels import ChannelService


def source(
    kind: NoteKind,
    identifier: UUID,
    channel_id: UUID,
    workspace_id: UUID,
    title: str,
    thread_root_id: UUID | None = None,
) -> NoteSource:
    params = (
        {"entry": str(identifier)}
        if kind == "journal"
        else (
            {
                "note": str(thread_root_id or identifier),
                **(
                    {"thread": str(thread_root_id), "reply": str(identifier)}
                    if thread_root_id
                    else {}
                ),
            }
            if kind == "message"
            else {}
        )
    )
    path = f"/w/{workspace_id}/c/{channel_id}"
    return NoteSource(
        id=identifier,
        kind=kind,
        title=title,
        url=path + ("?" + urlencode(params) if params else ""),
    )


def read_note(db: Session, owner_id: UUID, kind: NoteKind, identifier: UUID) -> dict[str, Any]:
    attachments = []
    thread_root_id = None
    if kind == "message":
        item = MessageService(db).get_message(identifier, owner_id)
        channel_id, content, title = item.channel_id, item.content, "Message"
        thread_root_id = item.thread_root_id
        attachments = [
            {
                "id": str(a.id),
                "name": a.original_filename,
                "content_type": a.content_type,
                "can_view": a.content_type in IMAGE_TYPES,
            }
            for a in item.attachments
        ]
        created_at = item.created_at
    elif kind == "journal":
        entry = db.get(JournalEntry, identifier)
        if entry is None or entry.author_id != owner_id:
            raise NotFoundError("Journal entry not found")
        channel_id, content, title = entry.channel_id, entry.content, entry.title
        created_at = entry.created_at
    else:
        document = db.get(ChannelDocument, identifier)
        if document is None:
            raise NotFoundError("Document not found")
        channel_id, content, title = document.channel_id, document.content, "Document"
        created_at = document.created_at
    channel = ChannelService(db).get_channel(channel_id, owner_id)
    workspace = db.get(Workspace, channel.workspace_id)
    assert workspace is not None
    title = f"{workspace.name} / #{channel.name}" + (f" / {title}" if kind == "journal" else "")
    return {
        "source": source(
            kind, identifier, channel_id, workspace.id, title, thread_root_id
        ).model_dump(mode="json"),
        "created_at": created_at.isoformat(),
        "text": readable(content),
        "attachments": attachments,
    }
