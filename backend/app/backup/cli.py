import argparse
import asyncio
import shutil
import sys
import tempfile
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.models import User
from app.backup.services.archive import validate_archive
from app.backup.services.exporter import BackupExporter
from app.backup.services.importer import BackupImporter
from app.core.config import Settings
from app.core.errors import ApplicationError, ConflictError
from app.core.storage_limits import MAX_ARCHIVE
from app.db.database import create_database_engine
from app.storage.local import LocalFileStorage
from app.workspaces.models import Workspace


async def run(command: str) -> None:
    settings = Settings()
    engine = create_database_engine(settings.database_url)
    try:
        with (
            Session(engine) as db,
            tempfile.TemporaryDirectory(prefix="noted-transfer-") as temporary,
        ):
            owner = db.scalar(select(User).where(User.is_owner.is_(True)))
            if owner is None:
                raise ConflictError("Create the destination owner before importing content.")
            directory = Path(temporary)
            archive = directory / "backup.zip"
            storage = LocalFileStorage(settings.storage_path)
            if command == "export":
                await BackupExporter(db, storage).create(owner.id, archive)
                with archive.open("rb") as file:
                    shutil.copyfileobj(file, sys.stdout.buffer, length=65536)
            else:
                if db.scalar(select(Workspace.id).limit(1)) is not None:
                    raise ConflictError(
                        "Automatic transfer only imports into an empty installation."
                    )
                size = 0
                with archive.open("xb") as file:
                    while chunk := sys.stdin.buffer.read(65536):
                        size += len(chunk)
                        if size > MAX_ARCHIVE:
                            raise ConflictError("The transfer archive exceeds 1 GB.")
                        file.write(chunk)
                data = validate_archive(archive, directory / "files")
                await BackupImporter(db, storage).restore(
                    data, directory / "files", owner.id, False
                )
                print("Content imported.")
    finally:
        engine.dispose()


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m app.portability")
    parser.add_argument("command", choices=["export", "import"])
    arguments = parser.parse_args()
    try:
        asyncio.run(run(arguments.command))
    except ApplicationError as error:
        raise SystemExit(error.message) from None


if __name__ == "__main__":
    main()
