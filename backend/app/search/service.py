from typing import Literal
from uuid import UUID

from sqlalchemy.orm import Session

from app.core.errors import ValidationError
from app.search.repository import SearchRepository
from app.search.schemas import SearchPage, SearchResult


def make_excerpt(content: str, query: str) -> str:
    match = content.lower().find(query.lower())
    start = max(0, match - 60)
    end = min(len(content), start + max(180, len(query) + 40))
    excerpt = content[start:end].replace("\n", " ")
    return ("…" if start else "") + excerpt + ("…" if end < len(content) else "")


class SearchService:
    def __init__(self, db: Session) -> None:
        self.repository = SearchRepository(db)

    def search(
        self,
        owner_id: UUID,
        query: str,
        workspace_id: UUID | None,
        channel_id: UUID | None,
        sort: Literal["newest", "oldest"],
        limit: int,
        offset: int,
    ) -> SearchPage:
        query = query.strip()
        if len(query) < 2:
            raise ValidationError("Enter at least two characters to search.")
        records, total = self.repository.search(
            owner_id, query, workspace_id, channel_id, sort, limit, offset
        )
        return SearchPage(
            items=[
                SearchResult(
                    id=record.id,
                    channel_id=record.channel_id,
                    thread_root_id=record.thread_root_id,
                    kind=record.kind,
                    workspace_id=record.workspace_id,
                    channel_name=record.channel_name,
                    workspace_name=record.workspace_name,
                    excerpt=make_excerpt(record.content, query),
                    created_at=record.created_at,
                )
                for record in records
            ],
            total=total,
            offset=offset,
        )
