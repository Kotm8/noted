from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, SecretStr

from app.notifications.firebase import FirebaseClient


class AndroidStatus(BaseModel):
    configured: bool
    subscribed: bool = False
    project_id: str | None = None


class PairingRequest(BaseModel):
    device_id: UUID


class PairingResponse(BaseModel):
    ticket: str
    expires_at: datetime


class TicketInput(BaseModel):
    ticket: SecretStr = Field(min_length=43, max_length=128)


class PairingConfiguration(BaseModel):
    client: FirebaseClient
    device_id: UUID


class TokenInput(BaseModel):
    token: SecretStr = Field(min_length=20, max_length=4096)


class PairingCompletion(TicketInput, TokenInput):
    secret: SecretStr = Field(min_length=43, max_length=128)


class NativeReminderAction(BaseModel):
    message_id: UUID
    action: Literal["done", "snooze"]
    revision: int = Field(ge=1)
    minutes: int | None = Field(default=None, ge=1, le=10080)
