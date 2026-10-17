from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator

from app.core.storage_limits import MAX_FILE_SIZE, MAX_ICON_SIZE
from app.reminders.schemas import ReminderSchedule


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
    kind: Literal["note", "reminder"] = "note"
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


class BackupAttachment(BackupRecord):
    id: UUID
    message_id: UUID
    filename: str = Field(min_length=1, max_length=255)
    content_type: str = Field(min_length=1, max_length=100)
    position: int = Field(ge=0, le=2147483647)
    created_at: AwareDatetime
    file: BackupBlob


class BackupContent(BackupRecord):
    format: Literal["noted-content-backup"] = "noted-content-backup"
    version: Literal[1] = 1
    created_at: AwareDatetime
    workspaces: list[BackupWorkspace]
    categories: list[BackupCategory]
    channels: list[BackupChannel]
    messages: list[BackupMessage]
    attachments: list[BackupAttachment]


class BackupCounts(BaseModel):
    projects: int
    categories: int
    channels: int
    messages: int
    files: int


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
