from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class SearchResult(BaseModel):
    id: UUID
    channel_id: UUID
    workspace_id: UUID
    channel_name: str
    workspace_name: str
    excerpt: str
    created_at: datetime


class SearchPage(BaseModel):
    items: list[SearchResult]
    total: int
    offset: int
