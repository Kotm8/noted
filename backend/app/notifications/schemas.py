from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator


class NotificationSettings(BaseModel):
    snooze_minutes: int = Field(default=10, ge=1, le=10080)
    enabled: bool = True
    android_enabled: bool = True
    plan_notice_minutes: Literal[0, 1, 5, 10] = 0
    quiet_hours: bool = False
    quiet_start_minute: int = Field(default=1320, ge=0, le=1439)
    quiet_end_minute: int = Field(default=480, ge=0, le=1439)

    @model_validator(mode="after")
    def quiet_window(self) -> "NotificationSettings":
        if self.quiet_start_minute == self.quiet_end_minute:
            raise ValueError("Quiet hours need different start and end times")
        return self


class PushTestResult(BaseModel):
    accepted: int = 0
    expired: int = 0
    failed: int = 0


class PresenceInput(BaseModel):
    device_id: UUID
    kind: Literal["desktop", "mobile"]
    focused: bool
