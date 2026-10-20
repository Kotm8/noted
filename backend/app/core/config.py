import os
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

VERSION = os.environ.get("NOTED_BUILD_VERSION", "0.2.1")
BUILD_COMMIT = os.environ.get("NOTED_BUILD_COMMIT", "development")
SCHEMA_REVISION = "0015_wear_os"
API_VERSION = 1


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="NOTED_", extra="ignore")

    database_url: str
    server_name: str = Field(default="Noted", min_length=1, max_length=80)
    app_origin: str = "http://localhost:5173"
    cookie_secure: bool = True
    session_hours: int = 168
    storage_path: Path = Path(__file__).resolve().parents[3] / ".local" / "attachments"
    updates_directory: Path | None = None
    backup_path: Path | None = None
    maintenance_path: Path | None = None
    instance_id: str = "development"

    @field_validator("app_origin")
    @classmethod
    def validate_origin(cls, value: str) -> str:
        from urllib.parse import urlsplit

        parsed = urlsplit(value)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            raise ValueError("An HTTP or HTTPS application origin is required")
        if parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError("Use an origin without credentials, query, or fragment")
        if parsed.path not in {"", "/"}:
            raise ValueError("Use an origin without a path")
        if parsed.scheme == "http" and parsed.hostname not in {"localhost", "127.0.0.1", "::1"}:
            raise ValueError("Public origins require HTTPS")
        return value.rstrip("/")
