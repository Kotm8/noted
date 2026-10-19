import base64
from typing import Literal
from urllib.parse import urlsplit
from uuid import UUID

from pydantic import BaseModel, Field, ValidationInfo, field_validator


class NotificationSettings(BaseModel):
    snooze_minutes: int = Field(default=10, ge=1, le=10080)
    enabled: bool = True
    android_enabled: bool = True
    plan_notice_minutes: Literal[0, 1, 5, 10] = 0


class PushTestResult(BaseModel):
    accepted: int = 0
    expired: int = 0
    failed: int = 0


class PresenceInput(BaseModel):
    device_id: UUID
    kind: Literal["desktop", "mobile"]
    focused: bool


class PushKeys(BaseModel):
    p256dh: str = Field(max_length=100)
    auth: str = Field(max_length=32)

    @field_validator("p256dh", "auth")
    @classmethod
    def valid_key(cls, value: str, info: ValidationInfo) -> str:
        try:
            decoded = base64.b64decode(
                value + "=" * (-len(value) % 4), altchars=b"-_", validate=True
            )
        except ValueError:
            raise ValueError("Invalid push encryption key") from None
        if len(decoded) != (65 if info.field_name == "p256dh" else 16):
            raise ValueError("Invalid push encryption key")
        if info.field_name == "p256dh":
            from cryptography.hazmat.primitives.asymmetric import ec

            ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), decoded)
        return value


class SubscriptionInput(BaseModel):
    device_id: UUID
    kind: Literal["desktop", "mobile"]
    endpoint: str = Field(max_length=2048)
    keys: PushKeys

    @field_validator("endpoint")
    @classmethod
    def valid_endpoint(cls, value: str) -> str:
        parsed = urlsplit(value)
        host = parsed.hostname or ""
        allowed = host in {"fcm.googleapis.com", "web.push.apple.com"} or any(
            host.endswith(suffix)
            for suffix in (".push.services.mozilla.com", ".notify.windows.com")
        )
        if (
            not allowed
            or parsed.scheme != "https"
            or parsed.username
            or parsed.password
            or parsed.fragment
            or parsed.port not in {None, 443}
        ):
            raise ValueError("Unsupported browser push service")
        return value
