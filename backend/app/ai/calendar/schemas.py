from datetime import date
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator

from app.ai.schemas import ConversationTurn
from app.schedule.schemas import PlanResponse
from app.time_tracking.schemas import check_timezone


class CalendarScope(BaseModel):
    start: date
    end: date
    timezone: str = Field(max_length=64)
    start_minute: int = Field(ge=0, le=1439)
    end_minute: int = Field(ge=1, le=1440)
    _timezone = field_validator("timezone")(check_timezone)

    @model_validator(mode="after")
    def valid_range(self) -> "CalendarScope":
        if not 0 <= (self.end - self.start).days <= 30:
            raise ValueError("Choose a date range of up to 31 days")
        if self.end_minute <= self.start_minute:
            raise ValueError("End time must follow start time")
        return self


class CalendarBlock(BaseModel):
    activity_id: UUID
    title: str = Field(min_length=1, max_length=120)
    date: date
    start_minute: int = Field(ge=0, le=1439)
    end_minute: int = Field(ge=1, le=1440)
    notifications_enabled: bool = True
    notification_minutes: Literal[0, 1, 5, 10] | None = None

    @model_validator(mode="after")
    def valid_block(self) -> "CalendarBlock":
        self.title = self.title.strip()
        if not self.title or self.end_minute <= self.start_minute:
            raise ValueError("Give each plan a title and a valid time range")
        return self


class CalendarProposal(BaseModel):
    explanation: str = Field(max_length=4000)
    blocks: list[CalendarBlock] = Field(max_length=60)


class CalendarRequest(CalendarScope):
    instructions: str = Field(min_length=1, max_length=4000)
    history: list[ConversationTurn] = Field(default_factory=list, max_length=20)
    proposals: list[CalendarBlock] = Field(default_factory=list, max_length=60)


class CalendarApply(CalendarScope):
    request_id: UUID
    blocks: list[CalendarBlock] = Field(min_length=1, max_length=60)


class CalendarApplication(BaseModel):
    request_id: UUID
    revision: int
    applied: bool
    plans: list[PlanResponse]


class CalendarApplicationUpdate(BaseModel):
    revision: int = Field(ge=1)
    applied: bool
