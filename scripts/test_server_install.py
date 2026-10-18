import argparse
import json
import os
import secrets
import socket
import ssl
import subprocess
import sys
import tempfile
import time
from dataclasses import asdict
from http.cookiejar import CookieJar
from pathlib import Path
from unittest.mock import patch
from urllib.request import HTTPCookieProcessor, HTTPSHandler, Request, build_opener
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "updater"))

from noted_updater import remote
from noted_updater.config import Config
from noted_updater.docker import Docker, OperationError
from noted_updater.files import read_json, write_file
from noted_updater.github import GitHubSource
from noted_updater.install import OWNER_SCRIPT, Installer
from noted_updater.release import extract_bundle

ROOT = Path(__file__).resolve().parents[1]


class InterruptedOwner(Docker):
    def compose(self, deployment, arguments, label, **options):
        if OWNER_SCRIPT in arguments:
            raise OperationError("Injected interruption before owner creation")
        return super().compose(deployment, arguments, label, **options)


def expect_failure(operation) -> None:
    try:
        operation()
    except OperationError:
        return
    raise AssertionError("The injected failure did not stop installation")


def finish_in_fixture(config: Config, units: list[str]) -> None:
    run = subprocess.run

    def systemctl(arguments, **options):
        if arguments[0] != "systemctl":
            return run(arguments, **options)
        assert arguments in (
            ["systemctl", "daemon-reload"],
            ["systemctl", "enable", "--now", "noted-updater.service"],
        )
        units.append(arguments[1])
        return subprocess.CompletedProcess(arguments, 0)

    def unit_file(path, content, mode):
        assert path == Path("/etc/systemd/system/noted-updater.service")
        write_file(config.directory / "noted-updater.service", content, mode)

    with (
        patch("noted_updater.remote.ROOT", config.directory),
        patch("noted_updater.__main__.Config", return_value=config),
        patch("noted_updater.remote.write_file", side_effect=unit_file),
        patch("noted_updater.remote.subprocess.run", side_effect=systemctl),
    ):
        remote.finish(config.repository)


def check_installation(config: Config, release, directory: Path, port: int) -> None:
    docker = Docker(config)
    deployment = {"compose": str(directory / "compose.production.yaml")}
    metadata = asdict(release.manifest)
    metadata.update(
        format=1,
        channel="main",
        configuration_version=1,
        api_version=1,
        minimum_updater_version=2,
        schema_revision=metadata.pop("schema"),
        supported_source_schemas=list(metadata.pop("supported_schemas")),
    )
    setup_id = secrets.token_hex(32)
    (directory / ".setup-id").write_text(setup_id)
    password = secrets.token_urlsafe(24)
    data = {
        "setup_id": setup_id,
        "repository": config.repository,
        "domain": "notes.example.com",
        "server_name": 'My $notes "and" memories',
        "username": "installer-owner",
        "password": password,
        "release": metadata,
    }
    phases = []

    def install(adapter, finish):
        Installer(
            directory,
            data,
            lambda phase, detail: phases.append(phase),
            docker=adapter,
            finisher=finish,
        ).run()

    def owner_count():
        return docker.compose(
            deployment,
            [
                "exec",
                "-T",
                "db",
                "psql",
                "-U",
                "noted",
                "-d",
                "noted",
                "-Atc",
                "SELECT count(*) FROM users WHERE is_owner",
            ],
            "Owner count",
        ).strip()

    def container(service):
        identifier = docker.compose(deployment, ["ps", "-q", service], "Container identity").strip()
        return docker.run(
            ["inspect", "--format", "{{.Id}} {{.State.StartedAt}}", identifier],
            "Container identity",
        ).strip()

    def interrupted_finish(repository):
        raise OperationError("Injected interruption before updater configuration")

    print("Starting the published images; interrupting before owner creation.", flush=True)
    expect_failure(lambda: install(InterruptedOwner(config), interrupted_finish))
    assert owner_count() == "0"
    environment = (directory / ".env").read_bytes()
    database = container("db")
    print(
        "Retrying through the real credential pipe; interrupting after owner creation.",
        flush=True,
    )
    expect_failure(lambda: install(docker, interrupted_finish))
    assert owner_count() == "1"
    assert (directory / ".env").read_bytes() == environment
    assert container("db") == database
    data["password"] = secrets.token_urlsafe(24)
    expect_failure(lambda: install(docker, interrupted_finish))
    assert owner_count() == "1"
    data["password"] = password
    units = []
    print(
        "Retrying with the original credentials and configuring the updater.",
        flush=True,
    )
    install(docker, lambda repository: finish_in_fixture(config, units))
    assert phases[-1] == "installed"
    assert units == ["daemon-reload", "enable"]
    assert read_json(config.control / "installed.json")["commit"] == release.manifest.commit
    assert read_json(config.control / "config.json")["repository"] == config.repository
    unit = (directory / "noted-updater.service").read_text()
    assert "python3 -m noted_updater run --config" in unit
    certificate = docker.compose(
        deployment,
        ["exec", "-T", "web", "cat", "/data/caddy/pki/authorities/local/root.crt"],
        "Fixture TLS certificate",
    )
    browser = build_opener(
        HTTPSHandler(context=ssl.create_default_context(cadata=certificate)),
        HTTPCookieProcessor(CookieJar()),
    )
    origin = f"https://localhost:{port}"

    def request(path, body=None):
        encoded = json.dumps(body).encode() if body is not None else None
        with browser.open(
            Request(
                origin + "/api/v1" + path,
                data=encoded,
                headers={"Origin": origin, "Content-Type": "application/json"},
            ),
            timeout=15,
        ) as response:
            return json.load(response)

    print("Checking trusted HTTPS, sign-in, and updater status through Caddy.", flush=True)
    assert request("/health/ready")["status"] == "ready"
    assert request("/version")["build_commit"] == release.manifest.commit
    request("/auth/login", {"username": data["username"], "password": password})
    status = request("/updates/status")
    assert status["configured"] and status["worker_online"]
    backend = container("backend")
    install(docker, lambda repository: finish_in_fixture(config, units))
    assert container("backend") == backend
    assert container("db") == database
    assert (directory / ".env").read_bytes() == environment
    assert owner_count() == "1"
    assert request("/auth/session")["username"] == data["username"]
    worker_script = (
        "from pathlib import Path;from noted_updater.config import Config;"
        "from noted_updater.worker import Worker;"
        f"Worker(Config(Path({str(directory)!r}),{config.repository!r},project={config.project!r})).run()"
    )
    environment_variables = {**os.environ, "PYTHONPATH": str(ROOT / "updater")}
    with (directory / "worker.log").open("wb") as log:
        process = subprocess.Popen(
            [sys.executable, "-c", worker_script],
            env=environment_variables,
            stdout=log,
            stderr=log,
        )
        try:
            deadline = time.monotonic() + 30
            while time.monotonic() < deadline:
                assert process.poll() is None, "The updater process exited during startup"
                if "capabilities" in read_json(config.state / "service.json"):
                    break
                time.sleep(0.25)
            else:
                raise AssertionError("The updater did not finish startup")
            assert request("/updates/status")["worker_online"]
        finally:
            process.terminate()
            process.wait(timeout=15)
    for path in directory.rglob("*"):
        if path.is_file() and password.encode() in path.read_bytes():
            raise AssertionError(f"Owner password was persisted in {path.name}")
    print(
        "PASS: fresh install, interrupted retries, owner protection, HTTPS login, "
        "updater startup, and completed-install retry.",
        flush=True,
    )
    print(
        "Systemd registration is intercepted in this fixture; "
        "the actual updater process is started and checked.",
        flush=True,
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Exercise installation against a published release."
    )
    parser.add_argument("--repository", default="kotm8/noted")
    args = parser.parse_args()
    if os.name != "nt" and os.geteuid() != 0:
        raise SystemExit(
            "Run this installer fixture as root on Linux so it can set volume ownership."
        )
    source = GitHubSource(args.repository)
    release = source.latest()
    if release is None:
        raise SystemExit("Publish a release before running the installation smoke test.")
    local = ROOT / ".local"
    local.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="install-smoke-", dir=local) as temporary:
        directory = Path(temporary).resolve()
        assert directory.is_relative_to(local.resolve())
        config = Config(directory, args.repository, project=f"noted-install-test-{uuid4().hex[:8]}")
        docker = Docker(config)
        deployment = {"compose": str(directory / "compose.production.yaml")}
        extract_bundle(source.bundle(release), release, directory)
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            port = listener.getsockname()[1]
        compose = (directory / "compose.production.yaml").read_text()
        compose = compose.replace(
            "https://${NOTED_DOMAIN:?Set the app domain}", f"https://localhost:{port}"
        )
        compose = compose.replace("      - '80:80'\n", "")
        compose = compose.replace("'443:443'", f"'127.0.0.1:{port}:443'")
        (directory / "compose.production.yaml").write_text(compose)
        proxy = (directory / "Caddyfile.production").read_text()
        proxy = proxy.replace("{$NOTED_DOMAIN} {", "https://localhost {\n    tls internal")
        (directory / "Caddyfile.production").write_text(proxy)
        try:
            check_installation(config, release, directory, port)
        except Exception:
            if (directory / ".env").exists():
                logs = docker.compose(
                    deployment, ["logs", "--no-color", "--tail", "80"], "Failure logs"
                )
                (local / "server-install-failure.log").write_text(logs)
            raise
        finally:
            if (directory / ".env").exists():
                docker.compose(
                    deployment,
                    ["down", "--volumes", "--remove-orphans"],
                    "Fixture cleanup",
                )


if __name__ == "__main__":
    main()
