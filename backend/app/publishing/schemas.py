from datetime import UTC, datetime
from typing import Literal
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, field_validator, model_validator

from app.time_tracking.schemas import check_timezone


class ScheduledFields(BaseModel):
    model_config = ConfigDict(extra="forbid")
    content: str = Field(min_length=1, max_length=40000)
    send_at: AwareDatetime
    timezone: str = Field(max_length=64)
    _timezone = field_validator("timezone")(check_timezone)

    @field_validator("content")
    @classmethod
    def nonempty(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Write a message to schedule")
        return value


class ScheduledUpdate(ScheduledFields):
    revision: int = Field(ge=1)


class ScheduledResponse(ScheduledFields):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    channel_id: UUID
    status: Literal["pending", "sent", "skipped", "cancelled"]
    revision: int
    message_id: UUID | None


class WritingFields(BaseModel):
    model_config = ConfigDict(extra="forbid")
    content: str = Field(min_length=1, max_length=500)
    start_at: AwareDatetime = Field(
        ge=datetime(1970, 1, 1, tzinfo=UTC), le=datetime(2100, 1, 1, tzinfo=UTC)
    )
    timezone: str = Field(max_length=64)
    frequency: Literal["daily", "weekly", "biweekly", "monthly"] = "daily"
    weekdays: list[int] = Field(default_factory=list, max_length=7)
    enabled: bool = True
    _timezone = field_validator("timezone")(check_timezone)

    @model_validator(mode="after")
    def valid_rule(self) -> "WritingFields":
        self.content = self.content.strip()
        if not self.content:
            raise ValueError("Give the writing prompt some text")
        if any(day < 0 or day > 6 for day in self.weekdays) or len(set(self.weekdays)) != len(
            self.weekdays
        ):
            raise ValueError("Choose valid, distinct weekdays")
        if self.frequency in {"weekly", "biweekly"} and not self.weekdays:
            raise ValueError("Choose at least one weekday")
        return self


class WritingUpdate(WritingFields):
    revision: int = Field(default=0, ge=0)


class WritingResponse(WritingFields):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    channel_id: UUID
    next_at: AwareDatetime | None
    due_at: AwareDatetime | None
    revision: int
