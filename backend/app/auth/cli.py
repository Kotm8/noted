import argparse
import getpass
import sys

from pydantic import SecretStr, ValidationError
from sqlalchemy.orm import Session

from app.auth.schemas import LoginRequest
from app.auth.services.auth import AuthService
from app.core.config import Settings
from app.core.errors import ApplicationError
from app.db.database import create_database_engine


def print_setup_secret() -> None:
    settings = Settings()
    engine = create_database_engine(settings.database_url)

    try:
        with Session(engine) as db:
            print(AuthService(db).generate_setup_secret())
    except ApplicationError as error:
        raise SystemExit(error.message) from error
    finally:
        engine.dispose()


def create_owner(read_stdin: bool) -> None:
    try:
        if read_stdin:
            raw = sys.stdin.buffer.read(4097)
            if len(raw) > 4096:
                raise SystemExit("Owner credentials are too large.")
            credentials = LoginRequest.model_validate_json(raw)
        else:
            username = input("Owner username: ").strip()
            password = getpass.getpass("Owner password: ")
            if password != getpass.getpass("Confirm password: "):
                raise SystemExit("Passwords do not match.")
            credentials = LoginRequest(username=username, password=SecretStr(password))
    except ValidationError:
        raise SystemExit("Provide a username and a password of 12 to 256 characters.") from None

    settings = Settings()
    engine = create_database_engine(settings.database_url)
    try:
        with Session(engine) as db:
            AuthService(db).provision_owner(credentials)
        print("Owner account created. Sign in with your username and password.")
    except ApplicationError as error:
        raise SystemExit(error.message) from error
    finally:
        engine.dispose()


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    parser.add_argument("command", choices=["bootstrap-secret", "create-owner"])
    parser.add_argument(
        "--stdin", action="store_true", help="Read owner credentials as JSON from stdin"
    )
    arguments = parser.parse_args()
    if arguments.command == "create-owner":
        create_owner(arguments.stdin)
    else:
        print_setup_secret()


if __name__ == "__main__":
    main()
