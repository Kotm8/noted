from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class JournalCreate(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    content: str = Field(default="", max_length=200000)

    @field_validator("title")
    @classmethod
    def valid_title(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Give the entry a name.")
        return value.strip()


class JournalUpdate(JournalCreate):
    revision: int = Field(ge=1, strict=True)


class JournalResponse(JournalUpdate):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    channel_id: UUID
    created_at: datetime
    updated_at: datetime


class JournalSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    channel_id: UUID
    title: str
    created_at: datetime
    updated_at: datetime
