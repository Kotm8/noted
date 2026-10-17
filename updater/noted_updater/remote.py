import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

from .__main__ import configure
from .config import Config
from .docker import Docker, OperationError
from .files import write_file

ROOT = Path("/opt/noted")


def initialise(data: dict) -> None:
    if (ROOT / ".env").exists():
        raise OperationError("The destination already has an installation.")
    for name in ("backend_image", "web_image"):
        if not re.fullmatch(r"sha256:[0-9a-f]{64}", data[name]):
            raise OperationError("Invalid transfer image identity.")
    values = {
        "POSTGRES_PASSWORD": data["database_password"],
        "NOTED_DOMAIN": data["domain"],
        "NOTED_SERVER_NAME": data["server_name"],
        "NOTED_BACKEND_IMAGE": data["backend_image"],
        "NOTED_WEB_IMAGE": data["web_image"],
        "NOTED_INSTANCE_ID": data["instance_id"],
    }
    write_file(
        ROOT / ".env",
        "".join(
            f"{key}={json.dumps(value).replace('$', '$$')}\n" for key, value in values.items()
        ).encode(),
    )
    for name in ("state", "requests", "maintenance"):
        path = ROOT / "updater" / name
        path.mkdir(parents=True, exist_ok=True)
        path.chmod(0o770 if name == "requests" else 0o755)
    os.chown(ROOT / "updater/requests", 1000, 1000)
    docker = Docker(Config(ROOT, data["repository"]))
    docker.compose(
        {"compose": str(ROOT / "compose.production.yaml")},
        ["up", "-d", "--wait", "--wait-timeout", "120"],
        "Destination startup",
        timeout=240,
    )


def finish(repository: str) -> None:
    if not (ROOT / "updater/installed.json").exists():
        configure(ROOT, repository, None)
    elif Config.load(ROOT / "updater/config.json").repository != repository:
        raise OperationError("The installed updater belongs to another repository.")
    unit = f"""[Unit]
Description=Noted server update worker
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target
[Service]
Type=simple
User=root
WorkingDirectory={ROOT}/updater/code
ExecStart=/usr/bin/python3 -m noted_updater run --config {ROOT}/updater/config.json
Restart=on-failure
RestartSec=5
UMask=0077
[Install]
WantedBy=multi-user.target
"""
    write_file(Path("/etc/systemd/system/noted-updater.service"), unit.encode(), 0o644)
    subprocess.run(["systemctl", "daemon-reload"], check=True)
    subprocess.run(["systemctl", "enable", "--now", "noted-updater.service"], check=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["initialise", "finish"])
    arguments = parser.parse_args()
    data = json.loads(sys.stdin.buffer.read(16385))
    if arguments.command == "initialise":
        initialise(data)
    else:
        finish(data["repository"])


if __name__ == "__main__":
    main()
