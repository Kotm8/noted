from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator

from app.core.storage_limits import MAX_FILE_SIZE, MAX_ICON_SIZE
from app.publishing.schemas import ScheduledFields, WritingFields
from app.reminders.schemas import ReminderSchedule
from app.schedule.schemas import PlanCreate, PlanFields
from app.time_tracking.schemas import ActivityCreate


class BackupRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")


class BackupBlob(BackupRecord):
    path: str = Field(pattern=r"^files/[0-9a-f]{32}$")
    size: int = Field(ge=0, le=MAX_FILE_SIZE)
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")


class BackupWorkspace(BackupRecord):
    id: UUID
    name: str = Field(min_length=1, max_length=80)
    icon: str = Field(min_length=1, max_length=8)
    position: int = Field(ge=0, le=2147483647)
    created_at: AwareDatetime
    image: BackupBlob | None = None
    image_type: Literal["image/png", "image/jpeg", "image/gif", "image/webp"] | None = None

    @model_validator(mode="after")
    def valid_image(self) -> "BackupWorkspace":
        if bool(self.image) != bool(self.image_type):
            raise ValueError("Incomplete project image")
        if self.image and self.image.size > MAX_ICON_SIZE:
            raise ValueError("Project image is too large")
        return self


class BackupCategory(BackupRecord):
    id: UUID
    workspace_id: UUID
    name: str = Field(min_length=1, max_length=80)
    position: int = Field(ge=0, le=2147483647)


class BackupChannel(BackupCategory):
    kind: Literal["note", "reminder", "journal", "document"] = "note"
    category_id: UUID | None
    created_at: AwareDatetime
    image: BackupBlob | None = None
    image_type: Literal["image/png", "image/jpeg", "image/gif", "image/webp"] | None = None

    @model_validator(mode="after")
    def valid_image(self) -> "BackupChannel":
        if bool(self.image) != bool(self.image_type):
            raise ValueError("Incomplete channel image")
        if self.image and self.image.size > MAX_ICON_SIZE:
            raise ValueError("Channel image is too large")
        return self


class BackupReminder(ReminderSchedule):
    model_config = ConfigDict(extra="forbid")
    scheduled_at: AwareDatetime
    status: Literal["active", "done"]


class BackupMessage(BackupRecord):
    id: UUID
    channel_id: UUID
    content: str = Field(max_length=40000)
    created_at: AwareDatetime
    updated_at: AwareDatetime
    reminder: BackupReminder | None = None
    thread_root_id: UUID | None = None


class BackupJournal(BackupRecord):
    id: UUID
    channel_id: UUID
    title: str = Field(min_length=1, max_length=120)
    content: str = Field(max_length=200000)
    revision: int = Field(ge=1)
    created_at: AwareDatetime
    updated_at: AwareDatetime


class BackupAttachment(BackupRecord):
    id: UUID
    message_id: UUID
    filename: str = Field(min_length=1, max_length=255)
    content_type: str = Field(min_length=1, max_length=100)
    position: int = Field(ge=0, le=2147483647)
    created_at: AwareDatetime
    file: BackupBlob


class BackupDocument(BackupRecord):
    channel_id: UUID
    content: str = Field(max_length=200000)
    revision: int = Field(ge=1)
    created_at: AwareDatetime
    updated_at: AwareDatetime


class BackupActivity(ActivityCreate, BackupRecord):
    id: UUID
    position: int = Field(ge=0, le=2147483647)
    archived: bool
    revision: int = Field(default=1, ge=1)


class BackupTimeSession(BackupRecord):
    id: UUID
    activity_id: UUID
    started_at: AwareDatetime
    ended_at: AwareDatetime
    revision: int = Field(default=1, ge=1)


class BackupPlan(PlanCreate, BackupRecord):
    id: UUID
    revision: int = Field(default=1, ge=1)


class BackupPlanException(PlanFields, BackupRecord):
    plan_id: UUID
    occurrence_date: date
    deleted: bool


class BackupPlanEvent(BackupRecord):
    id: UUID
    plan_id: UUID
    occurrence_date: date
    created_at: AwareDatetime
    action: Literal["start", "stop", "delay", "other"]
    minutes: Literal[5, 10, 15, 30, 60] | None
    reason: str | None = Field(max_length=500)
    activity_id: UUID | None


class BackupScheduledMessage(ScheduledFields, BackupRecord):
    id: UUID
    channel_id: UUID
    status: Literal["pending", "sent", "skipped", "cancelled"]
    revision: int = Field(ge=1)
    created_at: AwareDatetime


class BackupWritingPrompt(WritingFields, BackupRecord):
    id: UUID
    channel_id: UUID


class BackupContent(BackupRecord):
    format: Literal["noted-content-backup"] = "noted-content-backup"
    version: Literal[1, 2, 3, 4, 5, 6] = 1
    created_at: AwareDatetime
    workspaces: list[BackupWorkspace]
    categories: list[BackupCategory]
    channels: list[BackupChannel]
    messages: list[BackupMessage]
    attachments: list[BackupAttachment]
    journals: list[BackupJournal] = Field(default_factory=list)
    documents: list[BackupDocument] = Field(default_factory=list)
    activities: list[BackupActivity] = Field(default_factory=list)
    time_sessions: list[BackupTimeSession] = Field(default_factory=list)
    schedule_plans: list[BackupPlan] = Field(default_factory=list)
    schedule_exceptions: list[BackupPlanException] = Field(default_factory=list)
    plan_events: list[BackupPlanEvent] = Field(default_factory=list)
    scheduled_messages: list[BackupScheduledMessage] = Field(default_factory=list)
    writing_prompts: list[BackupWritingPrompt] = Field(default_factory=list)


class BackupCounts(BaseModel):
    projects: int
    categories: int
    channels: int
    messages: int
    files: int
    journals: int = 0
    documents: int = 0
    activities: int = 0
    time_sessions: int = 0
    schedule_plans: int = 0
    scheduled_messages: int = 0
    writing_prompts: int = 0


class BackupPreview(BaseModel):
    token: UUID
    created_at: datetime
    expires_at: datetime
    size: int
    counts: BackupCounts
    download_url: str | None = None


class ImportBackup(BackupRecord):
    token: UUID
    mode: Literal["merge", "replace"] = "merge"
    confirmation: str = ""


class ImportResult(BaseModel):
    counts: BackupCounts
