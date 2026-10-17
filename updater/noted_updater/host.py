import ipaddress
import json
import re
import shutil
import subprocess
from datetime import UTC, datetime, timedelta
from pathlib import Path
from urllib.request import urlopen
from uuid import UUID

from .docker import OperationError
from .engine import Engine
from .files import now, read_json, write_file, write_json
from .ssh import probe
from .transfer import Transfer

BUSY = {"queued", "running", "waiting_dns", "needs_recovery"}


class Host:
    def __init__(self, config, engine: Engine, transfer_factory=Transfer):
        self.config, self.engine, self.docker = config, engine, engine.docker
        self.transfer_factory = transfer_factory
        self.job = None

    @property
    def job_path(self) -> Path:
        return self.config.state / "host-job.json"

    def phase(self, phase: str, detail: str) -> None:
        self.job.update(status="running", phase=phase, detail=detail, updated_at=now())
        write_json(self.job_path, self.job, 0o644)

    def busy(self) -> bool:
        return self.job_path.exists() and read_json(self.job_path).get("status") in BUSY

    def pause(self, installed: dict) -> None:
        write_file(self.config.maintenance, b"host maintenance\n", 0o644)
        self.docker.compose(
            installed, ["stop", "-t", "30", "backend"], "Pausing source writes", timeout=60
        )

    def reopen(self, installed: dict) -> None:
        self.docker.start(installed)

    def apply(self, request: dict) -> bool:
        identifier = str(UUID(request["id"]))
        previous = read_json(self.job_path) if self.job_path.exists() else {}
        if previous.get("id") == identifier:
            return False
        if previous.get("status") in BUSY and not (
            request.get("action") == "cancel"
            and previous.get("status") == "waiting_dns"
            and previous.get("action") == "transfer"
        ):
            raise OperationError("A host operation already requires attention.")
        created = datetime.fromisoformat(request["created_at"])
        if created.tzinfo is None or not timedelta(0) <= datetime.now(UTC) - created < timedelta(
            minutes=10
        ):
            raise OperationError("The host request expired. Submit it again.")
        action = request["action"]
        if action == "cancel" and not (
            previous.get("action") == "transfer" and previous.get("status") == "waiting_dns"
        ):
            raise OperationError("There is no transfer waiting for DNS to cancel.")
        if action not in {"probe", "domain", "transfer", "remove", "cancel"}:
            raise OperationError("Unsupported host operation.")
        self.job = {
            "id": identifier,
            "action": action,
            "status": "running",
            "phase": "checking",
            "detail": "Checking the host request.",
            "created_at": request["created_at"],
            "updated_at": now(),
        }
        self.phase("checking", "Checking the host request.")
        installed = read_json(self.engine.ledger)
        paused = False
        try:
            if action == "probe":
                key, digest = probe(request["ip"], int(request["port"]))
                self.job.update(host_key=key, fingerprint=digest, ip=request["ip"])
            elif action == "domain":
                self.switch_domain(request, installed)
            elif action == "transfer":
                directory = self.config.control / "transfers" / identifier
                directory.mkdir(mode=0o700, parents=True)

                def pause():
                    nonlocal paused
                    paused = True
                    self.pause(installed)

                receipt = self.transfer_factory(self.config, self.docker, self.phase).run(
                    request, installed, directory, pause, lambda: self.reopen(installed)
                )
                self.job.update(
                    **receipt,
                    status="waiting_dns",
                    phase="waiting_dns",
                    detail="The destination is ready. Change the domain's DNS to the new IP. "
                    "Writes on this source remain paused until transfer is verified or cancelled.",
                )
            elif action == "cancel":
                self.config.maintenance.unlink(missing_ok=True)
                self.job.update(
                    status="cancelled",
                    detail="Source writes are available again. The destination copy has been "
                    "retained; do not use both copies concurrently.",
                )
            elif action == "remove":
                if request.get("confirmation") != "I LOVE VERITY":
                    raise OperationError("Type I LOVE VERITY to remove Noted and its data.")
                actual = json.loads(
                    self.docker.compose(
                        installed,
                        [
                            "exec",
                            "-T",
                            "backend",
                            "python",
                            "-c",
                            "import urllib.request; print(urllib.request.urlopen('http://localhost:8000/api/v1/version').read().decode())",
                        ],
                        "Deletion instance verification",
                    )
                )
                if (
                    not request.get("instance_id")
                    or actual.get("instance_id", "development") != request["instance_id"]
                ):
                    raise OperationError("The running server identity changed. Confirm again.")
                self.phase(
                    "removing",
                    "Removing this Noted installation and its data. The connection will close.",
                )
                return True
            if self.job["status"] == "running":
                self.job.update(
                    status="succeeded", phase="complete", detail="Host operation completed."
                )
        except Exception as error:
            recovered = self.engine.recover(installed) if paused or action == "domain" else True
            self.job.update(
                status="failed" if recovered else "needs_recovery",
                phase="failed",
                detail=(
                    str(error)
                    if isinstance(error, OperationError)
                    else "The host operation could not finish."
                )
                + (" Source content has been retained." if action == "transfer" else ""),
            )
        self.job["updated_at"] = now()
        write_json(self.job_path, self.job, 0o644)
        return False

    def switch_domain(self, request: dict, installed: dict) -> None:
        domain = request["domain"]
        try:
            ipaddress.ip_address(domain)
        except ValueError:
            pass
        else:
            raise OperationError("Use a domain, not an IP address.")
        if (
            len(domain) > 253
            or len(domain.split(".")) < 2
            or any(
                not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", label)
                for label in domain.split(".")
            )
            or request.get("dns_confirmed") is not True
        ):
            raise OperationError("Confirm DNS and provide a valid domain.")
        origin = f"https://{domain}"
        if origin == installed["origin"]:
            raise OperationError("This is already the configured domain.")
        path = self.config.directory / ".env"
        original = path.read_bytes()
        backup = self.config.control / f"domain-{self.job['id']}.env"
        write_file(backup, original)
        self.job.update(
            destination=origin, previous_origin=installed["origin"], env_backup=str(backup)
        )
        self.phase(
            "domain",
            "Applying the new domain and requesting its HTTPS certificate. "
            "Sign in again at the new address after verification.",
        )
        updated = []
        for line in original.decode().splitlines():
            if line.lstrip().startswith("NOTED_DOMAIN="):
                continue
            updated.append(line)
        updated.append(f"NOTED_DOMAIN={domain}")
        try:
            write_file(path, ("\n".join(updated) + "\n").encode())
            self.docker.start(installed)
            self.engine.verifier(
                origin, installed["commit"], installed["schema"], installed["version"]
            )
            write_json(self.engine.ledger, {**installed, "origin": origin})
            service = read_json(self.config.state / "service.json")
            service["origin"] = origin
            write_json(self.config.state / "service.json", service, 0o644)
        except Exception:
            write_file(path, original)
            write_json(self.engine.ledger, installed)
            service = read_json(self.config.state / "service.json")
            service["origin"] = installed["origin"]
            write_json(self.config.state / "service.json", service, 0o644)
            self.docker.start(installed)
            self.engine.verifier(
                installed["origin"], installed["commit"], installed["schema"], installed["version"]
            )
            raise OperationError(
                "The new domain could not be verified. The previous domain was restored."
            ) from None

    def poll_transfer(self) -> None:
        if not self.job_path.exists():
            return
        job = read_json(self.job_path)
        if job.get("status") != "waiting_dns":
            return
        try:
            with urlopen(f"{job['destination']}/api/v1/version", timeout=5) as response:
                version = json.load(response)
            if version.get("instance_id") != job["instance_id"]:
                return
            with urlopen(f"{job['destination']}/api/v1/health/ready", timeout=5) as response:
                if json.load(response).get("status") != "ready":
                    return
            job.update(
                status="succeeded",
                phase="complete",
                detail="Transfer verified through public HTTPS. Sign in on the destination. "
                "This source remains read-only; remove it only after checking the new server.",
                updated_at=now(),
            )
            write_json(self.job_path, job, 0o644)
        except (OSError, ValueError, KeyError):
            return

    def interrupted(self) -> None:
        if not self.job_path.exists():
            return
        job = read_json(self.job_path)
        if job.get("status") != "running":
            return
        if job.get("action") == "transfer":
            secret_directory = self.config.control / "transfers" / str(UUID(job["id"])) / "ssh"
            for name in ("password", "askpass"):
                (secret_directory / name).unlink(missing_ok=True)
        installed = read_json(self.engine.ledger)
        if job.get("action") == "domain" and job.get("env_backup"):
            backup = Path(job["env_backup"]).resolve()
            if backup.parent != self.config.control.resolve():
                raise OperationError("Invalid recovery environment path.")
            write_file(self.config.directory / ".env", backup.read_bytes())
            installed["origin"] = job["previous_origin"]
            write_json(self.engine.ledger, installed)
        recovered = self.engine.recover(installed)
        job.update(
            status="failed" if recovered else "needs_recovery",
            phase="failed",
            detail="The host worker restarted. Inspect any destination copy before retrying. "
            "Source recovery was attempted.",
            updated_at=now(),
        )
        write_json(self.job_path, job, 0o644)

    def remove(
        self, confirmation: str, system_directory: Path = Path("/etc/systemd/system")
    ) -> None:
        if confirmation != "I LOVE VERITY":
            raise OperationError("Type I LOVE VERITY to remove Noted and its data.")
        installed = read_json(self.engine.ledger)
        project = self.config.project
        if project != "noted":
            raise OperationError("Only the production noted project can be removed.")
        resolved = self.docker.resolved(installed)
        if set(resolved.get("services", {})) != {"db", "backend", "web", "migrate"}:
            raise OperationError("Unexpected services exist in this deployment.")
        if set(resolved.get("volumes", {})) != {
            "postgres_data",
            "attachments",
            "caddy_data",
            "caddy_config",
        }:
            raise OperationError("The persistent volumes do not match this installation.")
        for name, volume in resolved.get("volumes", {}).items():
            if (
                name not in {"postgres_data", "attachments", "caddy_data", "caddy_config"}
                or volume.get("external")
                or volume.get("name") != f"{project}_{name}"
            ):
                raise OperationError("Only this installation's private volumes may be removed.")
            identity = json.loads(
                self.docker.run(
                    ["volume", "inspect", volume["name"]], "Volume ownership verification"
                )
            )[0]
            if (identity.get("Labels") or {}).get("com.docker.compose.project") != project:
                raise OperationError("A data volume does not belong to this installation.")
            attached = self.docker.run(
                ["ps", "-aq", "--filter", f"volume={volume['name']}"], "Shared volume inspection"
            ).split()
            if attached:
                containers = json.loads(
                    self.docker.run(["inspect", *attached], "Volume consumer inspection")
                )
                for container in containers:
                    labels = container.get("Config", {}).get("Labels") or {}
                    if labels.get("com.docker.compose.project") != project or labels.get(
                        "com.docker.compose.service"
                    ) not in {"db", "backend", "web", "migrate"}:
                        raise OperationError(
                            "Another application uses a Noted volume. "
                            "Detach it before removing this installation."
                        )
        root = self.config.directory.resolve()
        if root in {Path("/"), Path("/opt"), Path("/var"), Path("/home")}:
            raise OperationError("The installation directory is unsafe to remove.")
        unit = system_directory / "noted-updater.service"
        if not unit.is_file() or f"WorkingDirectory={root}/updater/code" not in unit.read_text():
            raise OperationError("The updater service does not belong to this installation.")
        targets = [root / name for name in ("updater", "releases", "backups", "secrets")]
        for target in targets:
            if target.exists() and (
                target.is_symlink() or not target.resolve().is_relative_to(root)
            ):
                raise OperationError("A cleanup directory points outside this installation.")
        subprocess.run(
            ["systemctl", "disable", "noted-updater.service"], check=True, capture_output=True
        )
        self.docker.compose(
            installed,
            ["down", "--volumes", "--timeout", "30"],
            "Removing Noted containers and data",
            timeout=180,
        )
        unit.unlink()
        subprocess.run(["systemctl", "daemon-reload"], check=True, capture_output=True)
        for target in targets:
            if target.exists():
                shutil.rmtree(target)
        for name in (
            ".env",
            "compose.production.yaml",
            "Caddyfile.production",
            "production.env.example",
        ):
            (root / name).unlink(missing_ok=True)
        try:
            root.rmdir()
        except OSError:
            pass
