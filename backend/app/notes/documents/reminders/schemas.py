from typing import Literal
from uuid import UUID

from pydantic import ConfigDict, Field, field_validator

from app.reminders.schemas import ReminderSchedule


class DocumentReminderCreate(ReminderSchedule):
    id: UUID
    name: str = Field(min_length=1, max_length=500)

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Write a reminder name")
        return value.strip()


class DocumentReminderUpdate(ReminderSchedule):
    revision: int = Field(ge=1)


class DocumentReminderResponse(ReminderSchedule):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    channel_id: UUID
    name: str
    status: Literal["active", "done", "cancelled"]
    revision: int
