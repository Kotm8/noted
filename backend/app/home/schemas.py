from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


class HomeActivity(BaseModel):
    kind: Literal["reminder", "plan", "writing"]
    id: UUID
    revision: int
    title: str
    due_at: datetime
    read: bool
    workspace_id: UUID | None = None
    workspace_name: str | None = None
    channel_id: UUID | None = None
    channel_name: str | None = None


class HomeActivityPage(BaseModel):
    items: list[HomeActivity]
    has_more: bool


class ReadActivity(BaseModel):
    kind: Literal["reminder", "plan", "writing"]
    id: UUID
    revision: int = Field(ge=1)


class ReadActivities(BaseModel):
    items: list[ReadActivity] = Field(min_length=1, max_length=200)
