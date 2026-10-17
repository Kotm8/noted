import json
import shutil
import tempfile
import time
from pathlib import Path
from typing import Any
from urllib.request import urlopen
from uuid import UUID

from .config import Config
from .docker import Docker, OperationError
from .files import now, read_json, write_file, write_json
from .release import COMMIT, DIGEST, Release, extract_bundle

ACTIVE = {"queued", "running"}


def verify_http(origin: str, commit: str, schema: str, version: str) -> None:
    deadline = time.monotonic() + 120
    while time.monotonic() < deadline:
        try:
            with urlopen(f"{origin}/api/v1/health/ready", timeout=5) as response:
                ready = json.load(response)
            with urlopen(f"{origin}/api/v1/version", timeout=5) as response:
                actual = json.load(response)
            if (
                ready.get("status") == "ready"
                and actual.get("build_commit", "development") == commit
                and actual.get("schema_revision") == schema
                and actual.get("version") == version
            ):
                return
        except (OSError, ValueError):
            pass
        time.sleep(2)
    raise OperationError("Public HTTPS verification failed.")


class Engine:
    def __init__(self, config: Config, source, docker: Docker | None = None, verifier=verify_http):
        self.config = config
        self.source = source
        self.docker = docker or Docker(config)
        self.verifier = verifier

    @property
    def ledger(self) -> Path:
        return self.config.control / "installed.json"

    def phase(self, job: dict[str, Any], phase: str, detail: str) -> None:
        job.update(status="running", phase=phase, detail=detail, updated_at=now())
        write_json(self.config.state / "job.json", job, 0o644)

    def check(self) -> Release | None:
        service = read_json(self.config.state / "service.json")
        try:
            release = self.source.latest()
            service.update(
                last_checked=now(), check_error=None, latest=release.summary() if release else None
            )
            write_json(self.config.state / "service.json", service, 0o644)
            return release
        except Exception as error:
            service.update(
                last_checked=now(),
                check_error=(
                    "This release requires a newer VPS worker. Upgrade the worker first."
                    if isinstance(error, ValueError)
                    and str(error) == "Upgrade the server update worker first"
                    else "Could not check GitHub. Verify the repository and registry access."
                ),
            )
            write_json(self.config.state / "service.json", service, 0o644)
            raise OperationError("Update check failed.") from None

    def download_available(self, release: Release | None) -> None:
        if release is None:
            return
        installed = read_json(self.ledger)
        target = release.manifest
        if target.commit == installed["commit"] or target.sequence <= installed["sequence"]:
            return
        service = read_json(self.config.state / "service.json")
        if (
            service.get("download_commit") == target.commit
            and service.get("download_status") == "ready"
        ):
            return
        service.update(
            download_commit=target.commit, download_status="downloading", download_error=None
        )
        write_json(self.config.state / "service.json", service, 0o644)
        try:
            if installed["schema"] not in target.supported_schemas:
                raise OperationError("An intermediate release is required before this update.")
            candidate = self.stage(release)
            self.validate_deployment(installed, candidate, release)
            if shutil.disk_usage(self.config.directory).free < self.docker.required_space(
                installed
            ):
                raise OperationError("Free disk space is too low to prepare an update safely.")
            self.docker.ensure_image(target.backend_image)
            self.docker.ensure_image(target.web_image)
            service["download_status"] = "ready"
        except Exception as error:
            service.update(
                download_status="failed",
                download_error=str(error)
                if isinstance(error, OperationError)
                else "The update download failed. Check registry access and retry.",
            )
        write_json(self.config.state / "service.json", service, 0o644)

    def stage(self, release: Release) -> dict[str, Any]:
        manifest = release.manifest
        directory = self.config.directory / "releases" / manifest.commit
        marker = directory / "manifest.sha256"
        if directory.exists():
            if not marker.is_file() or marker.read_text() != release.manifest_sha256:
                raise OperationError("This release's immutable metadata has changed.")
        else:
            directory.parent.mkdir(parents=True, exist_ok=True)
            temporary = Path(tempfile.mkdtemp(prefix=".download-", dir=directory.parent))
            try:
                extract_bundle(self.source.bundle(release), release, temporary)
                write_file(temporary / "manifest.sha256", release.manifest_sha256.encode())
                temporary.rename(directory)
            finally:
                if temporary.exists():
                    shutil.rmtree(temporary)
        environment = directory / "release.env"
        content = (
            f"NOTED_BACKEND_IMAGE={manifest.backend_image}\nNOTED_WEB_IMAGE={manifest.web_image}\n"
            f"NOTED_CADDY_CONFIG={directory.as_posix()}/Caddyfile.production\n"
        )
        write_file(environment, content.encode())
        return {"compose": str(directory / "compose.production.yaml"), "env": str(environment)}

    def validate_deployment(
        self, installed: dict[str, Any], candidate: dict[str, Any], release: Release
    ) -> None:
        old = self.docker.resolved(installed)
        new = self.docker.resolved(candidate)
        if old["services"]["db"] != new["services"]["db"]:
            raise OperationError(
                "Database service changes require a separate maintenance procedure."
            )
        if old.get("volumes") != new.get("volumes"):
            raise OperationError("An update cannot replace persistent volumes.")
        for service in ("backend", "web"):
            old_mounts = {
                (mount["type"], mount["target"]): mount["source"]
                for mount in old["services"][service].get("volumes", [])
                if mount["type"] == "volume"
            }
            new_mounts = {
                (mount["type"], mount["target"]): mount["source"]
                for mount in new["services"][service].get("volumes", [])
                if mount["type"] == "volume"
            }
            if old_mounts != new_mounts:
                raise OperationError("An update cannot replace application data mounts.")
        expected = release.manifest
        if (
            new["services"]["backend"]["image"] != expected.backend_image
            or new["services"]["migrate"]["image"] != expected.backend_image
            or new["services"]["web"]["image"] != expected.web_image
        ):
            raise OperationError("Deployment images do not match the release manifest.")
        if new["services"]["backend"]["environment"]["NOTED_APP_ORIGIN"] != installed["origin"]:
            raise OperationError("An update cannot change the app's public address.")
        for service in ("backend", "migrate"):
            previous = old["services"][service].get("environment", {})
            updated = new["services"][service].get("environment", {})
            for key in (
                "NOTED_DATABASE_URL",
                "NOTED_APP_ORIGIN",
                "NOTED_SERVER_NAME",
                "NOTED_INSTANCE_ID",
                "NOTED_COOKIE_SECURE",
                "NOTED_STORAGE_PATH",
                "NOTED_UPDATES_DIRECTORY",
            ):
                if key in previous and updated.get(key) != previous[key]:
                    raise OperationError("An update cannot replace installation settings.")

    def recover(self, installed: dict[str, Any]) -> bool:
        try:
            if self.docker.schema(installed) != installed["schema"]:
                return False
            self.docker.start(installed)
            self.verifier(
                installed["origin"], installed["commit"], installed["schema"], installed["version"]
            )
            self.config.maintenance.unlink(missing_ok=True)
            return True
        except Exception:
            return False

    def apply(self, request: dict[str, Any]) -> None:
        identifier = str(UUID(request["id"]))
        commit = request["commit"]
        checksum = request["manifest_sha256"]
        if (
            not isinstance(commit, str)
            or not COMMIT.fullmatch(commit)
            or not isinstance(checksum, str)
            or not DIGEST.fullmatch(checksum)
        ):
            raise ValueError("Invalid update request")
        installed = read_json(self.ledger)
        job = {
            "id": identifier,
            "status": "running",
            "phase": "checking",
            "detail": "Checking the selected release.",
            "commit": commit,
            "started_at": now(),
            "updated_at": now(),
            "finished_at": None,
        }
        self.phase(job, "checking", "Checking the selected release.")
        maintenance = False
        try:
            release = self.check()
            if (
                release is None
                or release.manifest.commit != commit
                or release.manifest_sha256 != checksum
            ):
                raise OperationError("The available release changed. Check for updates again.")
            target = release.manifest
            if target.commit == installed["commit"] or target.sequence <= installed["sequence"]:
                raise OperationError(
                    "This release is already installed or older than this installation."
                )
            if installed["schema"] not in target.supported_schemas:
                raise OperationError("This schema needs an intermediate release before upgrading.")
            self.phase(job, "preparing", "Validating the deployment and available disk space.")
            candidate = self.stage(release)
            self.validate_deployment(installed, candidate, release)
            required_space = self.docker.required_space(installed)
            if shutil.disk_usage(self.config.directory).free < required_space:
                raise OperationError("There is not enough disk space for a verified backup.")
            self.phase(
                job, "downloading", "Downloading application images. Your notes remain available."
            )
            self.docker.ensure_image(target.backend_image)
            self.docker.ensure_image(target.web_image)
            if shutil.disk_usage(self.config.directory).free < required_space:
                raise OperationError("Image downloads left insufficient space for a backup.")
            job["target"] = {
                **candidate,
                "origin": installed["origin"],
                "commit": target.commit,
                "schema": target.schema,
                "version": target.version,
                "sequence": target.sequence,
                "manifest_sha256": checksum,
            }
            self.phase(job, "maintenance", "Pausing writes before backing up your notes.")
            write_file(self.config.maintenance, b"updating\n", 0o644)
            maintenance = True
            self.docker.compose(
                installed, ["stop", "-t", "30", "backend"], "Pausing application writes", timeout=60
            )
            self.phase(job, "backup", "Backing up PostgreSQL and attachments.")
            backup = self.config.directory / "backups" / identifier
            self.docker.backup(installed, backup)
            write_json(
                backup / "metadata.json",
                {"installed": installed, "target": release.summary(), "created_at": now()},
            )
            self.phase(job, "migrating", "Applying database migrations.")
            self.docker.compose(
                candidate,
                ["run", "--rm", "--no-deps", "-T", "--pull", "never", "migrate"],
                "Database migration",
                timeout=1800,
            )
            self.phase(job, "restarting", "Starting the updated application.")
            self.docker.start(candidate)
            self.phase(job, "verifying", "Verifying the release through your public app address.")
            self.verifier(installed["origin"], target.commit, target.schema, target.version)
            self.commit(job)
        except Exception as error:
            detail = (
                str(error)
                if isinstance(error, OperationError)
                else "The update could not be completed."
            )
            recovered = (
                (not maintenance or self.recover(installed))
                if job["phase"] != "committing"
                else False
            )
            job["failed_phase"] = job["phase"]
            job.update(
                status="failed" if recovered else "needs_recovery",
                phase="failed",
                detail=detail
                + (
                    " The previous version is available."
                    if recovered
                    else " Maintenance remains active. Restore or repair the installation "
                    "before reopening it."
                ),
            )
        job.update(updated_at=now(), finished_at=now())
        write_json(self.config.state / "job.json", job, 0o644)

    def commit(self, job: dict[str, Any]) -> None:
        self.phase(job, "committing", "Recording the verified release.")
        updated = job["target"]
        write_json(self.ledger, updated)
        service = read_json(self.config.state / "service.json")
        service["installed"] = {
            key: updated[key] for key in ("commit", "schema", "version", "sequence")
        }
        write_json(self.config.state / "service.json", service, 0o644)
        self.config.maintenance.unlink(missing_ok=True)
        job.update(
            status="succeeded",
            phase="complete",
            detail="Update installed. Reload the app to use the new version.",
        )

    def interrupted(self) -> None:
        path = self.config.state / "job.json"
        if not path.exists():
            return
        job = read_json(path)
        if job.get("status") not in ACTIVE:
            return
        installed = read_json(self.ledger)
        try:
            if installed["commit"] == job.get("commit") and job.get("target"):
                self.verifier(
                    installed["origin"],
                    installed["commit"],
                    installed["schema"],
                    installed["version"],
                )
                self.commit(job)
            elif not self.config.maintenance.exists() or self.recover(installed):
                job.update(
                    status="failed",
                    phase="failed",
                    detail="The update worker restarted. "
                    "The previous version is available; you can retry.",
                )
            else:
                job.update(
                    status="needs_recovery",
                    phase="failed",
                    detail="The worker stopped during a schema change. Maintenance remains active; "
                    "resume or restore from the recorded backup.",
                )
        except Exception:
            job.update(
                status="needs_recovery",
                phase="failed",
                detail="Interrupted update needs administrator recovery.",
            )
        job.update(updated_at=now(), finished_at=now())
        write_json(path, job, 0o644)

    def resume(self) -> None:
        job = read_json(self.config.state / "job.json")
        if job.get("status") != "needs_recovery" or not job.get("target"):
            raise OperationError("There is no interrupted target release to resume.")
        if not (
            self.config.directory / "backups" / str(UUID(job["id"])) / "metadata.json"
        ).is_file():
            raise OperationError("A validated backup is required before resuming migrations.")
        target = job["target"]
        try:
            self.phase(job, "migrating", "Resuming the recorded database migration.")
            self.docker.compose(
                target,
                ["run", "--rm", "--no-deps", "-T", "--pull", "never", "migrate"],
                "Database migration",
                timeout=1800,
            )
            self.docker.start(target)
            self.verifier(target["origin"], target["commit"], target["schema"], target["version"])
            self.commit(job)
        except Exception:
            job.update(
                status="needs_recovery",
                phase="failed",
                detail="Recovery did not finish. Maintenance remains active; repair and retry.",
            )
            raise OperationError("Recovery did not complete. Inspect the recorded job.") from None
        finally:
            job.update(updated_at=now(), finished_at=now())
            write_json(self.config.state / "job.json", job, 0o644)
