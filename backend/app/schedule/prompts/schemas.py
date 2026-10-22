from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator


class PromptResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    plan_id: UUID
    occurrence_date: date
    activity_id: UUID
    title: str
    planned_start: datetime
    planned_end: datetime | None = None
    phase: Literal["start", "end"] = "start"
    notify_at: datetime
    status: str
    revision: int


class PromptAction(BaseModel):
    action: Literal["start", "stop", "delay", "other"]
    revision: int = Field(ge=1)
    request_id: UUID
    minutes: Literal[5, 10, 15, 30, 60] | None = None
    reason: str | None = Field(default=None, max_length=500)
    activity_id: UUID | None = None
    requested_at: AwareDatetime | None = None

    @model_validator(mode="after")
    def validate_delay(self) -> "PromptAction":
        if self.action in {"delay", "other"}:
            if self.minutes is None or not self.reason or not self.reason.strip():
                raise ValueError("Choose a delay and a reason")
            self.reason = self.reason.strip()
        if self.action == "other" and self.activity_id is None:
            raise ValueError("Choose the activity you are working on")
        return self


class PromptEventResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    occurrence_date: date
    created_at: datetime
    action: str
    minutes: int | None
    reason: str | None
    activity_id: UUID | None
