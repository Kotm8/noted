import uuid
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, computed_field, field_validator

from app.reminders.schemas import ReminderResponse, ReminderSchedule
from app.storage.media import has_video_playback


class AttachmentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    original_filename: str
    content_type: str
    size: int

    @computed_field
    def download_url(self) -> str:
        return f"/api/v1/attachments/{self.id}/download"

    @computed_field
    def preview_url(self) -> str | None:
        if self.content_type in {"image/png", "image/jpeg", "image/gif", "image/webp"}:
            return f"/api/v1/attachments/{self.id}/preview"
        return None

    @computed_field
    def playback_url(self) -> str | None:
        if has_video_playback(self.content_type, self.original_filename):
            return f"/api/v1/attachments/{self.id}/playback"
        return None


class MessageCreate(BaseModel):
    content: str = Field(min_length=1, max_length=40000)
    reminder: ReminderSchedule | None = None

    @field_validator("content")
    @classmethod
    def nonempty(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Write something before sending")
        return value


class MessageUpdate(MessageCreate):
    expected_content: str | None = Field(default=None, max_length=40000)


class MessageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    content: str
    thread_root_id: UUID | None = None
    reply_count: int = 0
    id: uuid.UUID
    channel_id: uuid.UUID
    author_id: uuid.UUID
    created_at: datetime
    updated_at: datetime
    attachments: list[AttachmentResponse] = Field(default_factory=list)
    reminder: ReminderResponse | None = None


class MessagePage(BaseModel):
    items: list[MessageResponse]
    next_cursor: str | None
    newer_cursor: str | None = None
