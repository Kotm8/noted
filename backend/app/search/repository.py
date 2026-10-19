from dataclasses import dataclass
from datetime import datetime
from typing import Literal
from uuid import UUID

from sqlalchemy import cast, func, literal, null, or_, select, union_all
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Session

from app.journals.models import JournalEntry
from app.notes.documents.models import ChannelDocument
from app.notes.models import Message
from app.workspaces.models import Channel, Workspace


@dataclass(frozen=True)
class SearchRecord:
    id: UUID
    channel_id: UUID
    content: str
    created_at: datetime
    thread_root_id: UUID | None
    kind: Literal["message", "journal", "document"]
    channel_name: str
    workspace_name: str
    workspace_id: UUID


class SearchRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def search(
        self,
        owner_id: UUID,
        query: str,
        workspace_id: UUID | None,
        channel_id: UUID | None,
        sort: Literal["newest", "oldest"],
        limit: int,
        offset: int,
    ) -> tuple[list[SearchRecord], int]:
        escaped = query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        pattern = f"%{escaped}%"
        source = union_all(
            select(
                Message.id,
                Message.channel_id,
                Message.content,
                Message.created_at,
                Message.thread_root_id,
                literal("message").label("kind"),
            ).where(Message.deleted_at.is_(None), Message.content.ilike(pattern, escape="\\")),
            select(
                JournalEntry.id,
                JournalEntry.channel_id,
                (JournalEntry.title + "\n" + JournalEntry.content).label("content"),
                JournalEntry.created_at,
                cast(null(), PGUUID).label("thread_root_id"),
                literal("journal").label("kind"),
            ).where(
                or_(
                    JournalEntry.content.ilike(pattern, escape="\\"),
                    JournalEntry.title.ilike(pattern, escape="\\"),
                )
            ),
            select(
                ChannelDocument.channel_id.label("id"),
                ChannelDocument.channel_id,
                (Channel.name + "\n" + ChannelDocument.content).label("content"),
                ChannelDocument.created_at,
                cast(null(), PGUUID).label("thread_root_id"),
                literal("document").label("kind"),
            )
            .join(Channel, Channel.id == ChannelDocument.channel_id)
            .where(
                Channel.kind == "document",
                or_(
                    ChannelDocument.content.ilike(pattern, escape="\\"),
                    Channel.name.ilike(pattern, escape="\\"),
                ),
            ),
        ).subquery()
        filters = [Workspace.owner_id == owner_id]
        if workspace_id:
            filters.append(Workspace.id == workspace_id)
        if channel_id:
            filters.append(Channel.id == channel_id)

        total_statement = (
            select(func.count())
            .select_from(source)
            .join(Channel, Channel.id == source.c.channel_id)
            .join(Workspace, Workspace.id == Channel.workspace_id)
            .where(*filters)
        )
        total = self.db.scalar(total_statement) or 0
        order = (source.c.created_at.desc(), source.c.id.desc())
        if sort == "oldest":
            order = (source.c.created_at.asc(), source.c.id.asc())

        statement = (
            select(
                source,
                Channel.name.label("channel_name"),
                Workspace.name.label("workspace_name"),
                Workspace.id.label("workspace_id"),
            )
            .join(Channel, Channel.id == source.c.channel_id)
            .join(Workspace, Workspace.id == Channel.workspace_id)
            .where(*filters)
            .order_by(*order)
            .offset(offset)
            .limit(limit)
        )
        records = [SearchRecord(**row) for row in self.db.execute(statement).mappings()]
        return records, total
