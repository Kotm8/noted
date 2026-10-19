from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel


class SearchResult(BaseModel):
    kind: Literal["message", "journal", "document"] = "message"
    thread_root_id: UUID | None = None
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
