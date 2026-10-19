from datetime import datetime
from typing import Literal
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, field_validator, model_validator

ActivityIcon = Literal[
    "Code2",
    "BookOpen",
    "BriefcaseBusiness",
    "Trees",
    "Coffee",
    "Laptop",
    "Moon",
    "Sun",
    "Flag",
    "Activity",
]


def check_timezone(value: str) -> str:
    try:
        ZoneInfo(value)
    except (ValueError, ZoneInfoNotFoundError):
        raise ValueError("Choose a valid timezone") from None
    return value


class ActivityCreate(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    icon: ActivityIcon = "Activity"
    color: str = Field(default="#e2c15a", pattern=r"^#[0-9a-fA-F]{6}$")

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Give this activity a name")
        return value.strip()


class ActivityUpdate(ActivityCreate):
    archived: bool = False
    revision: int = Field(ge=1)


class ActivityResponse(ActivityCreate):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    position: int
    archived: bool
    revision: int


class ActivityOrder(BaseModel):
    ids: list[UUID] = Field(max_length=100)


class TrackingPreferences(BaseModel):
    start_minute: int = Field(default=480, ge=0, le=1380)
    end_minute: int = Field(default=1320, ge=60, le=1440)
    timezone: str = Field(default="UTC", max_length=64)
    _timezone = field_validator("timezone")(check_timezone)

    @model_validator(mode="after")
    def valid_hours(self) -> "TrackingPreferences":
        if self.end_minute - self.start_minute < 60:
            raise ValueError("The schedule must show at least one hour; end must follow start")
        return self


class TrackingPreferencesUpdate(TrackingPreferences):
    revision: int = Field(ge=1)


class SessionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    activity_id: UUID
    started_at: datetime
    ended_at: datetime | None
    revision: int


class SessionUpdate(BaseModel):
    activity_id: UUID
    started_at: AwareDatetime
    ended_at: AwareDatetime
    revision: int = Field(ge=1)


class TrackerResponse(BaseModel):
    revision: int
    active: SessionResponse | None
    paused_activity_id: UUID | None
    elapsed_seconds: int
    server_time: datetime
    preferences: TrackingPreferences


class TrackerAction(BaseModel):
    action: Literal["start", "pause", "resume", "stop"]
    activity_id: UUID | None = None
    revision: int = Field(ge=1)
    request_id: UUID
