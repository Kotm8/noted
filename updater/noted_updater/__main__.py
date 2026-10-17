import argparse
import json
import os
from pathlib import Path

from .config import Config, validate_origin
from .docker import Docker
from .engine import Engine
from .files import now, write_file, write_json
from .worker import Worker, process_lock


def configure(directory: Path, repository: str, token_file: Path | None) -> None:
    from .release import REPOSITORY

    directory = directory.resolve(strict=True)
    repository = repository.lower()
    if not REPOSITORY.fullmatch(repository):
        raise ValueError("Use a GitHub repository in owner/name format")
    config = Config(directory, repository, token_file=token_file)
    if (config.control / "installed.json").exists():
        raise ValueError("The updater is already configured; keep its installed release ledger")
    docker = Docker(config)
    deployment = {"compose": str(directory / "compose.production.yaml")}
    resolved = docker.resolved(deployment)
    origin = validate_origin(resolved["services"]["backend"]["environment"]["NOTED_APP_ORIGIN"])
    script = (
        "import urllib.request; "
        "print(urllib.request.urlopen('http://localhost:8000/api/v1/version').read().decode())"
    )
    version = json.loads(
        docker.compose(
            deployment,
            ["exec", "-T", "backend", "python", "-c", script],
            "Installed version inspection",
        )
    )
    for path in (config.state, config.requests, config.maintenance.parent):
        path.mkdir(parents=True, exist_ok=True)
        path.chmod(0o755 if path != config.requests else 0o770)
    if os.name != "nt":
        os.chown(config.requests, 1000, 1000)
    environment = config.control / "initial.env"
    images = {name: docker.running_image(deployment, name) for name in ("backend", "web")}
    write_file(
        environment,
        (
            f"NOTED_BACKEND_IMAGE={images['backend']}\nNOTED_WEB_IMAGE={images['web']}\n"
            f"NOTED_CADDY_CONFIG={directory.as_posix()}/Caddyfile.production\n"
        ).encode(),
    )
    installed = {
        **deployment,
        "env": str(environment),
        "origin": origin,
        "commit": version.get("build_commit", "development"),
        "version": version["version"],
        "schema": version["schema_revision"],
        "sequence": 0,
    }
    write_json(config.control / "installed.json", installed)
    write_json(
        config.control / "config.json",
        {
            "directory": str(directory),
            "repository": repository,
            "project": "noted",
            "token_file": str(token_file) if token_file else None,
        },
    )
    write_json(
        config.state / "service.json",
        {
            "repository": repository,
            "installed": {
                key: installed[key] for key in ("commit", "version", "schema", "sequence")
            },
            "latest": None,
            "last_checked": None,
            "check_error": None,
        },
        0o644,
    )
    write_json(config.state / "heartbeat.json", {"at": now()}, 0o644)
    print("Server updates configured. Start the noted-updater service.")


def main() -> None:
    parser = argparse.ArgumentParser(prog="python3 -m noted_updater")
    parser.add_argument("command", choices=["configure", "run", "resume", "remove"])
    parser.add_argument("--config", type=Path, default=Path("/opt/noted/updater/config.json"))
    parser.add_argument("--directory", type=Path, default=Path("/opt/noted"))
    parser.add_argument("--repository")
    parser.add_argument("--token-file", type=Path)
    arguments = parser.parse_args()
    if arguments.command == "configure":
        if not arguments.repository:
            parser.error("--repository is required")
        configure(arguments.directory, arguments.repository, arguments.token_file)
    elif arguments.command == "run":
        Worker(Config.load(arguments.config)).run()
    else:
        config = Config.load(arguments.config)
        with process_lock(config.control / "worker.lock"):
            if arguments.command == "remove":
                from .host import Host

                confirmation = input(
                    "Permanently remove Noted, notes, files, and its private volumes. "
                    "Type I LOVE VERITY: "
                )
                Host(config, Engine(config, None)).remove(confirmation)
            else:
                Engine(config, None).resume()


if __name__ == "__main__":
    main()
