from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class WritingNudgeSettings(BaseModel):
    enabled: bool = False
    interval_minutes: int = Field(default=30, ge=1, le=1440)
    content: str = Field(default="Write a quick update.", min_length=1, max_length=500)
    channel_id: UUID | None = None
    on_stop: bool = True

    @field_validator("content")
    @classmethod
    def clean_content(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Write a message for the nudge")
        return value.strip()

    @model_validator(mode="after")
    def target_required(self) -> "WritingNudgeSettings":
        if self.enabled and self.channel_id is None:
            raise ValueError("Choose a channel for writing nudges")
        return self


class NudgeResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    channel_id: UUID
    content: str
    due_at: datetime
    revision: int


class DismissNudge(BaseModel):
    revision: int = Field(ge=1)
