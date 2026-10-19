from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.time_tracking.schemas import SessionResponse, check_timezone


class PlanFields(BaseModel):
    activity_id: UUID
    title: str = Field(min_length=1, max_length=120)
    date: date
    start_minute: int = Field(ge=0, le=1439)
    end_minute: int = Field(ge=1, le=1440)
    timezone: str = Field(max_length=64)
    notifications_enabled: bool = True
    notification_minutes: Literal[0, 1, 5, 10] | None = None
    _timezone = field_validator("timezone")(check_timezone)

    @field_validator("title")
    @classmethod
    def clean_title(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Give the plan a title")
        return value.strip()

    @model_validator(mode="after")
    def valid_duration(self) -> "PlanFields":
        if self.end_minute <= self.start_minute:
            raise ValueError("End time must follow start time")
        return self


class PlanCreate(PlanFields):
    frequency: Literal["none", "daily", "weekly", "biweekly", "monthly"] = "none"
    weekdays: list[int] = Field(default_factory=list, max_length=7)
    repeat_until: date | None = None

    @model_validator(mode="after")
    def valid_recurrence(self) -> "PlanCreate":
        if any(day < 0 or day > 6 for day in self.weekdays) or len(set(self.weekdays)) != len(
            self.weekdays
        ):
            raise ValueError("Choose valid, distinct weekdays")
        if self.frequency in {"weekly", "biweekly"} and not self.weekdays:
            raise ValueError("Choose at least one weekday")
        if (
            self.repeat_until
            and self.repeat_until < self.date
            and getattr(self, "scope", "series") != "occurrence"
        ):
            raise ValueError("Repeat end must follow the start date")
        return self


class PlanResponse(PlanCreate):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    revision: int


class PlanUpdate(PlanCreate):
    revision: int = Field(ge=1)
    scope: Literal["series", "occurrence"] = "series"
    occurrence_date: date | None = None


class PlanOccurrence(PlanResponse):
    occurrence_date: date
    start_at: datetime
    end_at: datetime
    is_override: bool


class ReminderFlag(BaseModel):
    revision: int = 1
    message_id: UUID
    channel_id: UUID
    channel_name: str
    workspace_id: UUID
    workspace_name: str
    content: str
    due_at: datetime


class ScheduleBoard(BaseModel):
    plans: list[PlanOccurrence]
    sessions: list[SessionResponse]
    reminders: list[ReminderFlag]
