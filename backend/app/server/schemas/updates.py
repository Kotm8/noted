from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


class InstalledRelease(BaseModel):
    commit: str
    schema_revision: str = Field(alias="schema")
    version: str
    sequence: int


class AvailableRelease(BaseModel):
    commit: str = Field(pattern=r"^[0-9a-f]{40}$")
    sequence: int
    version: str
    manifest_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    url: str
    notes: str = Field(max_length=8000)
    published_at: str


class UpdateJob(BaseModel):
    id: UUID
    status: Literal["queued", "running", "succeeded", "failed", "needs_recovery"]
    phase: str
    detail: str
    commit: str
    started_at: datetime
    updated_at: datetime
    finished_at: datetime | None = None


class UpdateStatus(BaseModel):
    configured: bool = False
    worker_online: bool = False
    repository: str | None = None
    installed: InstalledRelease | None = None
    latest: AvailableRelease | None = None
    available: bool = False
    last_checked: datetime | None = None
    check_error: str | None = None
    download_commit: str | None = None
    download_status: Literal["downloading", "ready", "failed"] | None = None
    download_error: str | None = None
    job: UpdateJob | None = None


class ApplyUpdate(BaseModel):
    commit: str = Field(pattern=r"^[0-9a-f]{40}$")
    manifest_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
