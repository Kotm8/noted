from datetime import date
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.schedule.schemas import PlanResponse
from app.time_tracking.schemas import check_timezone
from app.writing_nudges.schemas import WritingNudgeSettings


class TemplateName(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)
    name: str = Field(min_length=1, max_length=70)

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Give the template a name")
        return value.strip()


class NoteTemplateFields(TemplateName):
    content: str = Field(max_length=40000)


class NoteTemplateUpdate(NoteTemplateFields):
    revision: int = Field(ge=1)


class NoteTemplateResponse(NoteTemplateUpdate):
    id: UUID


class DayBlock(BaseModel):
    model_config = ConfigDict(extra="forbid")
    activity_id: UUID
    title: str = Field(default="", max_length=120)
    start_minute: int = Field(ge=0, le=1439)
    end_minute: int = Field(ge=1, le=1440)
    notifications_enabled: bool = True
    notification_minutes: Literal[0, 1, 5, 10] | None = None
    writing_nudge: WritingNudgeSettings | None = None

    @model_validator(mode="after")
    def valid_duration(self) -> "DayBlock":
        if self.end_minute <= self.start_minute:
            raise ValueError("End time must follow start time")
        return self


class DayTemplateFields(TemplateName):
    blocks: list[DayBlock] = Field(default_factory=list, max_length=200)


class DayTemplateUpdate(DayTemplateFields):
    revision: int = Field(ge=1)


class DayTemplateResponse(DayTemplateUpdate):
    id: UUID


class TemplateDate(BaseModel):
    date: date
    timezone: str = Field(max_length=64)
    _timezone = field_validator("timezone")(check_timezone)


class CaptureDay(TemplateDate, TemplateName):
    pass


class ApplyDay(TemplateDate):
    revision: int = Field(ge=1)
    request_id: UUID


class AppliedDay(BaseModel):
    plans: list[PlanResponse]
