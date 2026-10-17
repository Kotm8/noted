import ipaddress
import re
from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator

from app.core.validation import Username


class HostRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")


class OwnerConfirmation(HostRequest):
    current_password: SecretStr = Field(min_length=1, max_length=256)


class HostProbe(HostRequest):
    ip: str
    port: int = Field(default=22, ge=1, le=65535)

    @field_validator("ip")
    @classmethod
    def public_address(cls, value: str) -> str:
        address = ipaddress.ip_address(value)
        if not address.is_global:
            raise ValueError("Enter the public IP address of the destination VPS")
        return str(address)


class TransferRequest(OwnerConfirmation, HostProbe):
    ssh_user: Literal["root"] = "root"
    ssh_password: SecretStr = Field(min_length=1, max_length=1024)
    host_key: str = Field(min_length=30, max_length=500)
    owner_username: Username
    owner_password: SecretStr = Field(min_length=12, max_length=256)
    pause_confirmed: Literal[True]

    @field_validator("host_key")
    @classmethod
    def ed25519_key(cls, value: str) -> str:
        if not re.fullmatch(r"ssh-ed25519 [A-Za-z0-9+/]{40,100}={0,2}", value):
            raise ValueError("Verify the destination's Ed25519 host key first")
        return value


class DomainRequest(OwnerConfirmation):
    domain: str = Field(min_length=3, max_length=253)
    dns_confirmed: Literal[True]

    @field_validator("domain")
    @classmethod
    def hostname(cls, value: str) -> str:
        value = value.lower().strip().rstrip(".")
        labels = value.split(".")
        if len(labels) < 2 or any(
            not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", label) for label in labels
        ):
            raise ValueError(
                "Enter a hostname such as notes.example.com, without https:// or a path"
            )
        try:
            ipaddress.ip_address(value)
        except ValueError:
            return value
        raise ValueError("Use a domain rather than an IP address")


class RemoveServer(OwnerConfirmation):
    confirmation: Literal["I LOVE VERITY"]
    instance_id: str = Field(min_length=1, max_length=100)


class HostJob(BaseModel):
    id: UUID
    action: Literal["probe", "transfer", "domain", "remove", "cancel"]
    status: Literal[
        "queued", "running", "waiting_dns", "succeeded", "failed", "needs_recovery", "cancelled"
    ]
    phase: str
    detail: str
    created_at: datetime
    updated_at: datetime
    destination: str | None = None
    ip: str | None = None
    fingerprint: str | None = None
    host_key: str | None = None


class HostStatus(BaseModel):
    configured: bool
    worker_online: bool
    capable: bool
    instance_id: str
    job: HostJob | None = None
