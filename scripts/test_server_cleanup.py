import json
import subprocess
import sys
import tempfile
from pathlib import Path
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "updater"))

from noted_updater.cleanup import Cleanup, CleanupError
from noted_updater.config import Config
from noted_updater.docker import Docker

ROOT = Path(__file__).resolve().parents[1]
IMAGE = "noted/backend:0.1.0-local"


def command(*arguments):
    return subprocess.check_output(["docker", *arguments], text=True).strip()


def expect_refusal(operation):
    try:
        operation()
    except CleanupError:
        return
    raise AssertionError("Unsafe cleanup was accepted")


def main():
    identifier = uuid4().hex[:8]
    project = f"noted-cleanup-test-{identifier}"
    keeper = f"noted-keep-test-{identifier}"
    shared = f"noted-shared-test-{identifier}"
    keep_volume = f"noted-keep-data-{identifier}"
    local = ROOT / ".local"
    local.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="cleanup-smoke-", dir=local) as temporary:
        parent = Path(temporary).resolve()
        assert parent.is_relative_to(local.resolve())
        directory = parent / "installation"
        directory.mkdir()
        config = Config(directory, "example/noted", project=project)
        docker = Docker(config)
        deployment = {"compose": str(directory / "compose.production.yaml")}
        cleanup = Cleanup(directory, project=project, system_directory=parent / "systemd")
        compose = {
            "services": {
                name: {
                    "image": IMAGE,
                    "entrypoint": ["python", "-c", "import time;time.sleep(600)"],
                    "volumes": mounts,
                }
                for name, mounts in {
                    "db": ["postgres_data:/fixture"],
                    "backend": ["attachments:/fixture"],
                    "web": ["caddy_data:/fixture", "caddy_config:/second"],
                    "migrate": [],
                }.items()
            },
            "volumes": {name: {} for name in Cleanup.volumes},
        }
        (directory / "compose.production.yaml").write_text(json.dumps(compose))
        (directory / ".env").write_text("FIXTURE=true\n")
        (directory / ".setup-id").write_text("a" * 64)
        (directory / ".setup.json").write_text(
            json.dumps(
                {
                    "setup_id": "a" * 64,
                    "repository": "example/noted",
                    "server_name": "Disposable notes",
                }
            )
        )
        try:
            docker.compose(deployment, ["up", "-d", "--wait"], "Cleanup fixture startup")
            command(
                "run",
                "-d",
                "--name",
                keeper,
                "-v",
                f"{keep_volume}:/data/keep",
                "--entrypoint",
                "python",
                IMAGE,
                "-c",
                "import time;time.sleep(600)",
            )
            keeper_before = command("inspect", "--format", "{{.Id}} {{.State.StartedAt}}", keeper)
            inspection, _ = cleanup.inspect(config.repository)
            assert inspection["containerCount"] == 4 and inspection["volumeCount"] == 4
            expect_refusal(
                lambda: cleanup.remove(config.repository, "wrong", inspection["snapshot"])
            )
            (directory / ".env").write_text("FIXTURE=changed\n")
            expect_refusal(
                lambda: cleanup.remove(config.repository, "I LOVE VERITY", inspection["snapshot"])
            )
            command("network", "connect", f"{project}_default", keeper)
            expect_refusal(lambda: cleanup.inspect(config.repository))
            command("network", "disconnect", f"{project}_default", keeper)
            command(
                "run",
                "-d",
                "--name",
                shared,
                "-v",
                f"{project}_attachments:/shared",
                "--entrypoint",
                "python",
                IMAGE,
                "-c",
                "import time;time.sleep(600)",
            )
            expect_refusal(lambda: cleanup.inspect(config.repository))
            command("rm", "-f", shared)
            inspection, _ = cleanup.inspect(config.repository)
            result = cleanup.remove(config.repository, "I LOVE VERITY", inspection["snapshot"])
            assert result["removed"] and not result["directoryRetained"]
            assert not directory.exists()
            assert (
                command("ps", "-aq", "--filter", f"label=com.docker.compose.project={project}")
                == ""
            )
            assert (
                command(
                    "volume", "ls", "-q", "--filter", f"label=com.docker.compose.project={project}"
                )
                == ""
            )
            assert (
                command(
                    "network", "ls", "-q", "--filter", f"label=com.docker.compose.project={project}"
                )
                == ""
            )
            assert (
                command("inspect", "--format", "{{.Id}} {{.State.StartedAt}}", keeper)
                == keeper_before
            )
            assert command("volume", "inspect", "--format", "{{.Name}}", keep_volume) == keep_volume
            print(
                "PASS: cleanup removed only fixture containers, volumes, network, and files; "
                "unrelated resources stayed running."
            )
            print(
                "PASS: wrong confirmation, changed inspection, shared volumes, "
                "and shared networks stopped cleanup."
            )
        finally:
            for name in (shared, keeper):
                subprocess.run(["docker", "rm", "-f", name], capture_output=True, check=False)
            subprocess.run(
                ["docker", "volume", "rm", keep_volume], capture_output=True, check=False
            )
            if directory.exists():
                docker.compose(deployment, ["down", "--volumes"], "Cleanup fixture teardown")


if __name__ == "__main__":
    main()
