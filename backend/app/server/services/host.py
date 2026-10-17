from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from sqlalchemy.orm import Session

from app.auth.models import User
from app.auth.services.rate_limit import RateLimitService
from app.core.config import Settings
from app.core.errors import AuthenticationError, ConflictError, ServiceUnavailableError
from app.core.security import verify_password
from app.server.lock import admin_request_lock
from app.server.schemas.host import HostJob, HostStatus, OwnerConfirmation
from app.server.services.updates import UpdateService


class HostService:
    def __init__(self, db: Session, settings: Settings) -> None:
        self.db = db
        self.settings = settings
        self.bridge = UpdateService(settings)

    def status(self) -> HostStatus:
        updates = self.bridge.status()
        directory = self.bridge.directory
        service = self.bridge.read(directory / "state/service.json") if directory else None
        raw = self.bridge.read(directory / "state/host-job.json") if directory else None
        queued = self.bridge.read(directory / "requests/host.json") if directory else None
        if queued and (not raw or raw.get("id") != queued.get("id")):
            raw = {key: queued.get(key) for key in ("id", "action", "created_at", "ip")}
            raw.update(
                status="queued",
                phase="queued",
                detail="Waiting for the host worker.",
                updated_at=queued["created_at"],
            )
        job = None
        if raw:
            try:
                job = HostJob.model_validate(raw)
            except ValueError:
                pass
        return HostStatus(
            instance_id=self.settings.instance_id,
            configured=updates.configured,
            worker_online=updates.worker_online,
            capable=bool(service and "host-admin-v1" in service.get("capabilities", [])),
            job=job,
        )

    def confirm_owner(self, data: OwnerConfirmation, user: User, address: str) -> None:
        RateLimitService(self.db).check_login_attempt(address)
        if not verify_password(data.current_password.get_secret_value(), user.password_hash):
            raise AuthenticationError("The current password is incorrect")

    def enqueue(self, action: str, values: dict[str, Any]) -> HostJob:
        with admin_request_lock(self.db):
            return self.queue_locked(action, values)

    def queue_locked(self, action: str, values: dict[str, Any]) -> HostJob:
        updates = self.bridge.require_worker()
        status = self.status()
        if not status.capable:
            raise ServiceUnavailableError(
                "Upgrade the host worker to enable server administration."
            )
        if updates.job and updates.job.status in {"queued", "running", "needs_recovery"}:
            raise ConflictError("Finish or recover the server update first.")
        if status.job and status.job.status in {
            "queued",
            "running",
            "waiting_dns",
            "needs_recovery",
        }:
            if not (
                action == "cancel"
                and status.job.action == "transfer"
                and status.job.status == "waiting_dns"
            ):
                raise ConflictError("Another host operation is active or requires recovery.")
        created = datetime.now(UTC).isoformat()
        request = {**values, "id": str(uuid4()), "action": action, "created_at": created}
        if not self.bridge.enqueue("host.json", request):
            raise ConflictError("A host operation is already queued.")
        return HostJob.model_validate(
            {
                key: value
                for key, value in request.items()
                if key in {"id", "action", "created_at", "ip"}
            }
            | {
                "status": "queued",
                "phase": "queued",
                "detail": "Waiting for the host worker.",
                "updated_at": created,
            }
        )
