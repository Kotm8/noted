import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, SecretStr
from pydantic.alias_generators import to_camel

from app.core.validation import Username


class LoginRequest(BaseModel):
    username: Username
    password: SecretStr = Field(min_length=12, max_length=256)


class SetupRequest(LoginRequest):
    setup_secret: SecretStr = Field(min_length=1, max_length=256)


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    username: str


class PasswordChangeRequest(BaseModel):
    current_password: SecretStr = Field(min_length=1, max_length=256)
    new_password: SecretStr = Field(min_length=12, max_length=256)


class SessionResponse(BaseModel):
    id: uuid.UUID
    created_at: datetime | None
    last_seen_at: datetime | None
    expires_at: datetime
    user_agent: str | None
    is_current: bool


Color = Annotated[str, Field(pattern=r"^#[0-9a-fA-F]{6}$")]


class AppearancePreferences(BaseModel):
    model_config = ConfigDict(extra="forbid", alias_generator=to_camel, populate_by_name=True)
    preset: Literal["modern", "charcoal", "warm", "slate"] = "modern"
    background: Color = "#1f1f1f"
    sidebar: Color = "#181818"
    text: Color = "#cccccc"
    accent: Color = "#e2c15a"
    text_size: int = Field(default=15, ge=12, le=20, strict=True)
    zoom: int = Field(default=100, ge=75, le=150, strict=True)
    message_layout: Literal["minute", "connected", "quiet", "rows"] = "minute"
    message_group_minutes: int = Field(default=2, ge=1, le=30, strict=True)
