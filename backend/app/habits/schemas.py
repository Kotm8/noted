from datetime import date
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.time_tracking.schemas import check_timezone


class HabitFields(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    kind: Literal["check", "count", "time"] = "check"
    goal: float = Field(default=1, gt=0, le=100000, allow_inf_nan=False)
    unit: str = Field(default="times", min_length=1, max_length=20)
    period: Literal["Morning", "Anytime", "Evening"] = "Anytime"
    weekdays: list[int] = Field(default_factory=lambda: list(range(7)), min_length=1, max_length=7)
    activity_id: UUID | None = None
    timezone: str = Field(default="UTC", max_length=64)
    starts_on: date
    reminder_start: date | None = None
    reminder_minute: int | None = Field(default=None, ge=0, le=1439)
    _timezone = field_validator("timezone")(check_timezone)

    @field_validator("name", "unit")
    @classmethod
    def trimmed(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Enter a value")
        return value.strip()

    @field_validator("weekdays")
    @classmethod
    def days(cls, value: list[int]) -> list[int]:
        if any(day < 0 or day > 6 for day in value) or len(set(value)) != len(value):
            raise ValueError("Choose distinct weekdays from Monday to Sunday")
        return sorted(value)

    @model_validator(mode="after")
    def valid_goal(self) -> "HabitFields":
        if self.activity_id and self.kind != "time":
            raise ValueError("An activity link requires a time goal")
        if self.kind == "check":
            self.goal = 1
        if self.kind == "time":
            self.unit = "min"
        return self


class HabitUpdate(HabitFields):
    revision: int = Field(ge=1)


class HabitResponse(HabitFields):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    revision: int


class ProgressInput(BaseModel):
    day: date
    value: float = Field(ge=0, le=100000, allow_inf_nan=False)
    revision: int = Field(ge=0)


class HabitProgress(BaseModel):
    habit_id: UUID
    day: date
    value: float
    revision: int
    due: bool


class HabitBoard(BaseModel):
    habits: list[HabitResponse]
    progress: list[HabitProgress]
