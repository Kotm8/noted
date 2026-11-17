import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator
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

ColorToken = Literal[
    "headings",
    "projectIcons",
    "rail",
    "header",
    "floating",
    "input",
    "hover",
    "selected",
    "textSecondary",
    "textMuted",
    "textFaint",
    "border",
    "borderSubtle",
]


ProfileKey = Literal[
    "modern-dark",
    "modern-light",
    "comic-dark",
    "comic-light",
    "snow-dark",
    "snow-light",
    "stars-dark",
    "stars-light",
]
ProfileColorToken = Literal["background", "sidebar", "text", ColorToken]


class AppearanceTheme(BaseModel):
    model_config = ConfigDict(extra="forbid", alias_generator=to_camel, populate_by_name=True)
    preset: Literal["modern", "charcoal", "warm", "slate"] = "modern"
    style: Literal["modern", "comic", "snow", "stars"] = "modern"
    mode: Literal["dark", "light"] = "dark"
    colors: dict[ColorToken, Color] = Field(default_factory=dict)
    profiles: dict[ProfileKey, dict[ProfileColorToken, Color]] = Field(default_factory=dict)
    background: Color = "#1f1f1f"
    sidebar: Color = "#181818"
    text: Color = "#cccccc"
    accent: Color = "#e2c15a"
    text_size: int = Field(default=15, ge=12, le=20, strict=True)
    zoom: int = Field(default=100, ge=75, le=150, strict=True)
    message_layout: Literal["minute", "connected", "quiet", "rows"] = "minute"
    message_group_minutes: int = Field(default=2, ge=1, le=30, strict=True)
    density: Literal["compact", "comfortable", "spacious"] = "comfortable"
    font: Literal["system", "sans", "serif", "mono"] = "system"
    code_font: Literal["system", "consolas", "courier"] = "system"
    line_height: float = Field(default=1.6, ge=1.2, le=2)
    reading_width: int = Field(default=960, ge=480, le=1600, strict=True)
    reduced_motion: bool = False
    high_contrast: bool = False


class AppearancePreferences(AppearanceTheme):
    saved_themes: dict[str, AppearanceTheme] = Field(default_factory=dict, max_length=20)

    @field_validator("saved_themes")
    @classmethod
    def valid_theme_names(cls, value: dict[str, AppearanceTheme]) -> dict[str, AppearanceTheme]:
        if any(not name.strip() or len(name) > 60 for name in value):
            raise ValueError("Theme names must contain between 1 and 60 characters")
        return value
