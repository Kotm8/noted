import argparse
import os
import secrets
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
ENV_FILE = ROOT / ".local" / "compose.env"


def initialize() -> None:
    ENV_FILE.parent.mkdir(parents=True, exist_ok=True)
    if ENV_FILE.exists():
        print("Local configuration already exists. Keeping the existing password.")
        return

    password = secrets.token_urlsafe(32)
    with ENV_FILE.open("x", encoding="utf-8") as file:
        file.write(f"POSTGRES_PASSWORD={password}\n")
    ENV_FILE.chmod(0o600)
    print("Created local development credentials in .local/compose.env.")


def database_password() -> str:
    if not ENV_FILE.exists():
        raise SystemExit("Run python scripts/dev.py init first.")

    values = dict(
        line.split("=", 1)
        for line in ENV_FILE.read_text(encoding="utf-8").splitlines()
        if line.strip()
    )
    return values["POSTGRES_PASSWORD"]


def backend_python() -> Path:
    executable = BACKEND / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    if not executable.exists():
        raise SystemExit("Install backend dependencies first: cd backend && uv sync --locked")
    return executable


def development_environment() -> dict[str, str]:
    environment = os.environ.copy()
    password = database_password()
    environment["NOTED_DATABASE_URL"] = (
        f"postgresql+psycopg://noted:{password}@127.0.0.1:55432/noted"
    )
    environment["NOTED_APP_ORIGIN"] = "http://localhost:5173"
    environment["NOTED_COOKIE_SECURE"] = "false"
    environment["NOTED_TEST_DATABASE_URL"] = environment["NOTED_DATABASE_URL"]
    return environment


def compose(arguments: list[str], development: bool = False) -> None:
    database_password()
    command = [
        "docker",
        "compose",
        "--env-file",
        str(ENV_FILE),
        "-f",
        str(ROOT / "deploy/compose.yaml"),
    ]
    if development:
        command.extend(["-f", str(ROOT / "deploy/compose.dev.yaml")])
    subprocess.run([*command, *arguments], cwd=ROOT, check=True)


def run_backend(arguments: list[str]) -> None:
    subprocess.run(
        [str(backend_python()), *arguments],
        cwd=BACKEND,
        env=development_environment(),
        check=True,
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Run Noted locally without changing Git configuration."
    )
    parser.add_argument(
        "command",
        choices=[
            "init",
            "db",
            "migrate",
            "setup-secret",
            "create-owner",
            "api",
            "test",
            "test-full",
            "test-browser",
            "test-browser-full",
            "test-desktop",
            "up",
            "stop",
        ],
    )
    args = parser.parse_args()

    match args.command:
        case "init":
            initialize()
        case "db":
            compose(["up", "-d", "--wait", "db"], development=True)
        case "migrate":
            run_backend(["-m", "alembic", "upgrade", "head"])
        case "setup-secret":
            run_backend(["-m", "app.cli", "bootstrap-secret"])
        case "create-owner":
            run_backend(["-m", "app.cli", "create-owner"])
        case "api":
            run_backend(
                [
                    "-m",
                    "uvicorn",
                    "app.main:create_app",
                    "--factory",
                    "--host",
                    "127.0.0.1",
                    "--port",
                    "8000",
                    "--reload",
                ]
            )
        case "test":
            run_backend(["-m", "tests.suites"])
        case "test-full":
            run_backend(["-m", "tests.suites", "--full"])
        case "test-browser":
            run_backend(["-m", "tests.browser_runner"])
        case "test-browser-full":
            run_backend(["-m", "tests.browser_runner", "--full"])
        case "test-desktop":
            run_backend(["-m", "tests.desktop_runner"])
        case "up":
            compose(["up", "-d", "--build", "--wait"])
        case "stop":
            compose(["stop"])


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as error:
        sys.exit(error.returncode)
