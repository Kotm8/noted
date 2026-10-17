from dataclasses import dataclass
from typing import Literal
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.notes.models import Message
from app.workspaces.models import Channel, Workspace


@dataclass(frozen=True)
class SearchRecord:
    message: Message
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
        filters = [
            Workspace.owner_id == owner_id,
            Message.deleted_at.is_(None),
            Message.content.ilike(f"%{escaped}%", escape="\\"),
        ]
        if workspace_id:
            filters.append(Workspace.id == workspace_id)
        if channel_id:
            filters.append(Channel.id == channel_id)

        total_statement = (
            select(func.count())
            .select_from(Message)
            .join(Channel, Channel.id == Message.channel_id)
            .join(Workspace, Workspace.id == Channel.workspace_id)
            .where(*filters)
        )
        total = self.db.scalar(total_statement) or 0
        order = (Message.created_at.desc(), Message.id.desc())
        if sort == "oldest":
            order = (Message.created_at.asc(), Message.id.asc())

        statement = (
            select(Message, Channel.name, Workspace.name, Workspace.id)
            .join(Channel, Channel.id == Message.channel_id)
            .join(Workspace, Workspace.id == Channel.workspace_id)
            .where(*filters)
            .order_by(*order)
            .offset(offset)
            .limit(limit)
        )
        records = [SearchRecord(*row) for row in self.db.execute(statement)]
        return records, total
