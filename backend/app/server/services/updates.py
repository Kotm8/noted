import json
import os
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

from pydantic import ValidationError

from app.core.config import Settings
from app.core.errors import ConflictError, ServiceUnavailableError
from app.server.schemas.updates import ApplyUpdate, UpdateJob, UpdateStatus


class UpdateService:
    def __init__(self, settings: Settings) -> None:
        self.directory = settings.updates_directory

    def read(self, path: Path) -> dict[str, Any] | None:
        try:
            with path.open("rb") as file:
                content = file.read(131073)
            if len(content) > 131072:
                return None
            result = json.loads(content)
            return result if isinstance(result, dict) else None
        except (OSError, ValueError):
            return None

    def status(self) -> UpdateStatus:
        if self.directory is None:
            return UpdateStatus()
        service = self.read(self.directory / "state" / "service.json")
        if service is None:
            return UpdateStatus()
        heartbeat = self.read(self.directory / "state" / "heartbeat.json")
        try:
            seen = datetime.fromisoformat(str(heartbeat["at"])) if heartbeat else None
            online = (
                seen is not None
                and seen.tzinfo is not None
                and 0 <= (datetime.now(UTC) - seen).total_seconds() < 90
            )
            status = UpdateStatus.model_validate(
                {**service, "configured": True, "worker_online": online}
            )
            job = self.read(self.directory / "state" / "job.json")
            pending = self.read(self.directory / "requests" / "apply.json")
            if pending and (not job or job.get("id") != pending.get("id")):
                job = {
                    **pending,
                    "status": "queued",
                    "phase": "queued",
                    "detail": "Waiting for the server update worker.",
                    "started_at": pending["created_at"],
                    "updated_at": pending["created_at"],
                }
            if job:
                status.job = UpdateJob.model_validate(job)
            status.available = bool(
                status.latest
                and status.installed
                and status.latest.sequence > status.installed.sequence
                and status.latest.commit != status.installed.commit
            )
            return status
        except (KeyError, TypeError, ValueError, ValidationError):
            return UpdateStatus(check_error="The update worker state could not be read.")

    def enqueue(self, name: str, value: dict[str, Any]) -> bool:
        if self.directory is None:
            raise ServiceUnavailableError("Server updates are not configured.")
        directory = self.directory / "requests"
        temporary: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="w", encoding="utf-8", dir=directory, prefix=".request-", delete=False
            ) as file:
                temporary = Path(file.name)
                json.dump(value, file)
                file.flush()
                os.fsync(file.fileno())
            os.link(temporary, directory / name)
            return True
        except FileExistsError:
            return False
        except OSError:
            raise ServiceUnavailableError("Could not contact the server update worker.") from None
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)

    def require_worker(self) -> UpdateStatus:
        status = self.status()
        if not status.configured or not status.worker_online:
            raise ServiceUnavailableError("The server update worker is not connected.")
        return status

    def check(self) -> None:
        self.require_worker()
        self.enqueue("check.json", {"created_at": datetime.now(UTC).isoformat()})

    def apply(self, data: ApplyUpdate, owner_id: str) -> UpdateJob:
        status = self.require_worker()
        if self.directory:
            host_job = self.read(self.directory / "state/host-job.json")
            if (self.directory / "requests/host.json").exists() or (
                host_job
                and host_job.get("status") in {"queued", "running", "waiting_dns", "needs_recovery"}
            ):
                raise ConflictError("Finish the host operation before installing an update.")
        if status.job and status.job.status in {"queued", "running", "needs_recovery"}:
            if status.job.commit == data.commit and status.job.status != "needs_recovery":
                return status.job
            raise ConflictError("An update is already running or requires recovery.")
        if (
            not status.available
            or status.latest is None
            or status.latest.commit != data.commit
            or status.latest.manifest_sha256 != data.manifest_sha256
        ):
            raise ConflictError("The available update changed. Check for updates again.")
        created = datetime.now(UTC).isoformat()
        request = {
            "id": str(uuid4()),
            "commit": data.commit,
            "manifest_sha256": data.manifest_sha256,
            "requested_by": owner_id,
            "created_at": created,
        }
        if not self.enqueue("apply.json", request):
            raise ConflictError("Another update request is already queued.")
        return UpdateJob.model_validate(
            {
                **request,
                "status": "queued",
                "phase": "queued",
                "detail": "Waiting for the server update worker.",
                "started_at": created,
                "updated_at": created,
            }
        )
