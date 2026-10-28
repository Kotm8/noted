from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, SecretStr

from app.notifications.firebase import FirebaseClient
from app.notifications.schemas import NotificationSettings
from app.schedule.prompts.schemas import PromptResponse
from app.schedule.schemas import ScheduleBoard
from app.time_tracking.schemas import ActivityResponse, TrackerResponse


class WatchSettings(BaseModel):
    face: Literal["W07", "W16", "W24"] = "W16"
    accent: str = Field(default="#e2c15a", pattern=r"^#[0-9a-fA-F]{6}$")
    text_scale: float = Field(default=1, ge=0.85, le=1.3)
    schedule_hours: Literal[2, 4, 6, 8] = 4
    hide_contents: bool = False
    favorites: list[UUID] = Field(default_factory=list, max_length=20)


class WatchPairingInput(BaseModel):
    ticket: SecretStr = Field(min_length=43, max_length=128)
    name: str = Field(default="Galaxy Watch", min_length=1, max_length=80)


class WatchCredentials(BaseModel):
    origin: str
    secret: str
    device_id: UUID
    expires_at: datetime


class WatchSnapshot(BaseModel):
    tracker: TrackerResponse
    activities: list[ActivityResponse]
    board: ScheduleBoard
    prompts: list[PromptResponse]
    settings: WatchSettings
    notifications: NotificationSettings
    firebase: FirebaseClient | None


class WatchTestResult(BaseModel):
    test_id: UUID
    outcome: Literal["accepted", "expired", "failed"]


class WatchToken(BaseModel):
    token: SecretStr = Field(min_length=20, max_length=4096)
