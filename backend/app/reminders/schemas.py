from datetime import datetime
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, field_validator


class ReminderSchedule(BaseModel):
    due_at: AwareDatetime
    timezone: str = Field(default="UTC", max_length=64)
    repeat: Literal["none", "daily", "weekdays", "weekly"] = "none"

    @field_validator("timezone")
    @classmethod
    def valid_timezone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError):
            raise ValueError("Choose a valid timezone") from None
        return value


class ReminderResponse(ReminderSchedule):
    model_config = ConfigDict(from_attributes=True)
    status: Literal["active", "done"]
    revision: int
    scheduled_at: datetime


class ReminderAction(BaseModel):
    action: Literal["done", "restore", "snooze"]
    revision: int = Field(ge=1)
    minutes: int | None = Field(default=None, ge=1, le=10080)
