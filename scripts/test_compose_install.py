import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def run() -> None:
    resources = ROOT / "updater/noted_updater/resources"
    helpers = [
        (resources / name).read_text().split("ensure_compose() (", 1)[1].split("\n)\n", 1)[0]
        for name in ("prepare-desktop.sh", "provision.sh")
    ]
    if helpers[0] != helpers[1]:
        raise RuntimeError("Desktop setup and VPS transfer must share Compose repair behavior")
    fixture = (ROOT / "updater/tests/fixtures/compose_repair.py").read_text()
    subprocess.run(
        [
            "docker",
            "run",
            "--rm",
            "-i",
            "--network",
            "none",
            "--env",
            "NOTED_COMPOSE_FIXTURE=1",
            "python:3.14.5-slim",
            "python",
            "-c",
            fixture,
        ],
        input=("ensure_compose() (" + helpers[0] + "\n)\n").encode(),
        check=True,
    )


if __name__ == "__main__":
    run()
