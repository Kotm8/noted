import contextlib
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path


class CleanupError(Exception):
    pass


class Cleanup:
    services = {"db", "backend", "web", "migrate"}
    volumes = {"postgres_data", "attachments", "caddy_data", "caddy_config"}
    directories = ("updater", "releases", "backups", "secrets")
    files = (".env", "compose.production.yaml", "Caddyfile.production", "production.env.example")

    def __init__(self, root, project="noted", system_directory=Path("/etc/systemd/system")):
        self.root = Path(root)
        self.project = project
        self.unit = system_directory / "noted-updater.service"

    def command(self, arguments):
        try:
            result = subprocess.run(arguments, capture_output=True, timeout=120)
        except (OSError, subprocess.TimeoutExpired):
            raise CleanupError(
                "A cleanup command did not complete. Inspect the VPS before retrying."
            ) from None
        if result.returncode:
            raise CleanupError("A cleanup command failed. No unrelated services were targeted.")
        return result.stdout.decode()

    def docker(self, *arguments):
        return self.command(["docker", *arguments])

    def read(self, path):
        if path.is_symlink() or not path.is_file() or path.stat().st_size > 131072:
            raise CleanupError("The installation metadata is unsafe or unreadable.")
        value = json.loads(path.read_text())
        if not isinstance(value, dict):
            raise CleanupError("The installation metadata is invalid.")
        return value

    def inspect(self, repository):
        root = self.root
        if not root.is_absolute() or root.is_symlink() or root.resolve() != root:
            raise CleanupError("The installation directory is unsafe to remove.")
        if root in {Path(root.anchor), Path("/opt"), Path("/var"), Path("/home")}:
            raise CleanupError("The installation directory is unsafe to remove.")
        resources = {"containers": [], "volumes": [], "networks": []}
        if shutil.which("docker"):
            identifiers = self.docker(
                "ps", "-aq", "--filter", f"label=com.docker.compose.project={self.project}"
            ).split()
            if identifiers:
                for item in json.loads(self.docker("inspect", *identifiers)):
                    labels = item["Config"].get("Labels") or {}
                    if (
                        labels.get("com.docker.compose.project") != self.project
                        or labels.get("com.docker.compose.service") not in self.services
                        or Path(labels.get("com.docker.compose.project.working_dir", "")).resolve()
                        != root
                    ):
                        raise CleanupError(
                            "A container in this Docker project belongs to another installation."
                        )
                    resources["containers"].append(item["Id"])
            names = self.docker(
                "volume", "ls", "-q", "--filter", f"label=com.docker.compose.project={self.project}"
            ).split()
            if names:
                for item in json.loads(self.docker("volume", "inspect", *names)):
                    name = item["Name"]
                    logical = (item.get("Labels") or {}).get("com.docker.compose.volume")
                    if (
                        (item.get("Labels") or {}).get("com.docker.compose.project") != self.project
                        or logical not in self.volumes
                        or name != f"{self.project}_{logical}"
                    ):
                        raise CleanupError("The Docker project contains an unexpected data volume.")
                    consumers = self.docker("ps", "-aq", "--filter", f"volume={name}").split()
                    if consumers:
                        users = json.loads(self.docker("inspect", *consumers))
                        if any(user["Id"] not in resources["containers"] for user in users):
                            raise CleanupError(
                                "Another application uses a Noted volume. Cleanup was stopped."
                            )
                    resources["volumes"].append(name)
            names = self.docker(
                "network",
                "ls",
                "-q",
                "--filter",
                f"label=com.docker.compose.project={self.project}",
            ).split()
            if names:
                for item in json.loads(self.docker("network", "inspect", *names)):
                    if (
                        (item.get("Labels") or {}).get("com.docker.compose.project") != self.project
                        or item["Name"] != f"{self.project}_default"
                        or any(
                            identifier not in resources["containers"]
                            for identifier in item.get("Containers", {})
                        )
                    ):
                        raise CleanupError(
                            "A network is shared with another application. Cleanup was stopped."
                        )
                    resources["networks"].append(item["Id"])
        present = root.exists()
        identity = None
        files = {}
        if present:
            marker = root / ".setup-id"
            if marker.is_symlink() or not marker.is_file() or marker.stat().st_size > 128:
                raise CleanupError("This directory does not have a valid Noted installer marker.")
            identity = marker.read_text().strip()
            if not re.fullmatch(r"[a-f0-9]{64}", identity):
                raise CleanupError("This directory does not have a valid Noted installer marker.")
            metadata = root / ".setup.json"
            setup = self.read(metadata) if metadata.exists() else {}
            if setup and (
                setup.get("setup_id") != identity or setup.get("repository") != repository
            ):
                raise CleanupError(
                    "The server installation belongs to another setup or repository."
                )
            for name in (*self.directories, *self.files, ".setup.json", ".setup.lock"):
                path = root / name
                if path.is_symlink() or path.resolve().parent != root:
                    raise CleanupError("A cleanup path points outside this installation.")
                if path.is_file():
                    if path.stat().st_size > 131072:
                        raise CleanupError("An installation metadata file is unexpectedly large.")
                    files[name] = hashlib.sha256(path.read_bytes()).hexdigest()
            for name in ("job.json", "host-job.json"):
                path = root / "updater/state" / name
                if path.exists() and self.read(path).get("status") in {
                    "queued",
                    "running",
                    "waiting_dns",
                }:
                    raise CleanupError(
                        "A server update or transfer is active. Finish it before cleanup."
                    )
        else:
            setup = {}
            if any(resources.values()):
                raise CleanupError(
                    "Noted resources exist without their installation marker. "
                    "Inspect the VPS manually."
                )
        if self.unit.exists() or self.unit.is_symlink():
            if (
                self.unit.is_symlink()
                or not self.unit.is_file()
                or self.unit.stat().st_size > 16384
            ):
                raise CleanupError("The update service does not belong to this installation.")
            unit = self.unit.read_text()
            lines = unit.splitlines()
            expected_command = (
                "ExecStart=/usr/bin/python3 -m noted_updater run --config "
                f"{root}/updater/config.json"
            )
            if (
                f"WorkingDirectory={root}/updater/code" not in lines
                or expected_command not in lines
            ):
                raise CleanupError("The update service does not belong to this installation.")
            files["systemd-unit"] = hashlib.sha256(unit.encode()).hexdigest()
        for values in resources.values():
            values.sort()
        snapshot = hashlib.sha256(
            json.dumps({"identity": identity, "files": files, **resources}, sort_keys=True).encode()
        ).hexdigest()
        return {
            "present": present,
            "serverName": setup.get("server_name", "Unfinished Noted setup"),
            "domain": setup.get("domain", ""),
            "snapshot": snapshot,
            "containerCount": len(resources["containers"]),
            "volumeCount": len(resources["volumes"]),
        }, resources

    def remove(self, repository, confirmation, snapshot):
        if confirmation != "I LOVE VERITY":
            raise CleanupError("Type I LOVE VERITY exactly to confirm removal.")
        inspection, resources = self.inspect(repository)
        if snapshot != inspection["snapshot"]:
            raise CleanupError(
                "The installation changed. Inspect it again before confirming cleanup."
            )
        if self.unit.exists():
            self.command(["systemctl", "disable", "--now", "noted-updater.service"])
        if resources["containers"]:
            self.docker("stop", "--time", "30", *resources["containers"])
            self.docker("rm", *resources["containers"])
        if resources["volumes"]:
            self.docker("volume", "rm", *resources["volumes"])
        if resources["networks"]:
            self.docker("network", "rm", *resources["networks"])
        if self.unit.exists():
            self.unit.unlink()
            self.command(["systemctl", "daemon-reload"])
        for name in self.directories:
            path = self.root / name
            if path.exists():
                shutil.rmtree(path)
        for name in (*self.files, ".setup.json", ".setup.lock", ".setup-id"):
            (self.root / name).unlink(missing_ok=True)
        with contextlib.suppress(OSError):
            self.root.rmdir()
        return {"removed": True, "directoryRetained": self.root.exists()}

    @contextlib.contextmanager
    def lock(self):
        if self.root.is_symlink() or self.root.resolve() != self.root:
            raise CleanupError("The installation directory is unsafe to remove.")
        if not self.root.exists():
            yield
            return
        marker = self.root / ".setup-id"
        if marker.is_symlink() or not marker.is_file() or marker.stat().st_size > 128:
            raise CleanupError("This directory does not have a valid Noted installer marker.")
        path = self.root / ".setup.lock"
        if path.is_symlink():
            raise CleanupError("The installation lock points outside this installation.")
        with path.open("a+b") as file:
            if os.name != "nt":
                import fcntl

                try:
                    fcntl.flock(file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError:
                    raise CleanupError(
                        "Setup is still running. Wait for it to stop before cleanup."
                    ) from None
            yield


def main():
    try:
        if os.name == "nt" or os.geteuid() != 0:
            raise CleanupError("Cleanup requires the root SSH account on the VPS.")
        data = json.loads(sys.stdin.buffer.read(16385))
        if not isinstance(data, dict) or set(data) - {
            "action",
            "repository",
            "confirmation",
            "snapshot",
        }:
            raise CleanupError("Invalid cleanup request.")
        repository = data.get("repository", "")
        if not isinstance(repository, str) or not re.fullmatch(
            r"[a-z0-9][a-z0-9_.-]*/[a-z0-9][a-z0-9_.-]*", repository
        ):
            raise CleanupError("Invalid release repository.")
        cleanup = Cleanup(Path("/opt/noted"))
        with cleanup.lock():
            if data.get("action") == "inspect":
                result, _ = cleanup.inspect(repository)
            elif data.get("action") == "remove":
                result = cleanup.remove(repository, data.get("confirmation"), data.get("snapshot"))
            else:
                raise CleanupError("Invalid cleanup action.")
        print(json.dumps(result))
    except (CleanupError, OSError, ValueError, KeyError, TypeError) as error:
        message = (
            str(error)
            if isinstance(error, CleanupError)
            else "Cleanup stopped safely. Inspect the VPS before retrying."
        )
        print(json.dumps({"error": message}))
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
