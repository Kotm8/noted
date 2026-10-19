import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, computed_field

from app.core.validation import Name


class WorkspaceCreate(BaseModel):
    name: Name
    icon: str = Field(default="✦", min_length=1, max_length=8)
    position: int = Field(default=0, ge=0)


class WorkspaceResponse(WorkspaceCreate):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    created_at: datetime
    icon_storage_key: str | None = Field(default=None, exclude=True)

    @computed_field
    def icon_url(self) -> str | None:
        if self.icon_storage_key:
            return f"/api/v1/workspaces/{self.id}/icon?v={self.icon_storage_key.split('/')[-1]}"
        return None


class CategoryCreate(BaseModel):
    name: Name
    position: int = Field(default=0, ge=0)


class CategoryResponse(CategoryCreate):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    workspace_id: uuid.UUID


class ChannelCreate(BaseModel):
    name: Name
    position: int = Field(default=0, ge=0)
    category_id: uuid.UUID | None = None
    kind: Literal["note", "reminder", "journal", "document"] = "note"


class ChannelResponse(ChannelCreate):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    workspace_id: uuid.UUID
    created_at: datetime
    banner_storage_key: str | None = Field(default=None, exclude=True)

    @computed_field
    def banner_url(self) -> str | None:
        if self.banner_storage_key:
            version = self.banner_storage_key.split("/")[-1]
            return f"/api/v1/channels/{self.id}/banner?v={version}"
        return None
