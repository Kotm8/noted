import json
import shutil
import sys
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import UUID, uuid4

from app.core.errors import ConflictError, NotFoundError

LIFETIME = timedelta(hours=1)


class BackupCache:
    def __init__(self, directory: Path) -> None:
        self.directory = directory.resolve()
        self.directory.mkdir(mode=0o700, parents=True, exist_ok=True)

    @contextmanager
    def operation(self, owner_id: UUID) -> Iterator[None]:
        with (self.directory / f"owner-{owner_id}.lock").open("a+b") as file:
            try:
                if sys.platform == "win32":
                    import msvcrt

                    if file.tell() == 0:
                        file.write(b"0")
                        file.flush()
                    file.seek(0)
                    msvcrt.locking(file.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl

                    fcntl.flock(file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError:
                raise ConflictError(
                    "Another backup or import is running. Wait for it to finish."
                ) from None
            try:
                yield
            finally:
                if sys.platform == "win32":
                    file.seek(0)
                    msvcrt.locking(file.fileno(), msvcrt.LK_UNLCK, 1)
                else:
                    fcntl.flock(file.fileno(), fcntl.LOCK_UN)

    def create(self, owner_id: UUID) -> tuple[UUID, Path]:
        self.expire()
        token = uuid4()
        path = self.directory / str(token)
        path.mkdir(mode=0o700)
        (path / "owner.json").write_text(
            json.dumps(
                {
                    "owner_id": str(owner_id),
                    "expires_at": (datetime.now(UTC) + LIFETIME).isoformat(),
                }
            )
        )
        return token, path

    def get(self, token: UUID, owner_id: UUID) -> Path:
        path = self.directory / str(token)
        try:
            owner = json.loads((path / "owner.json").read_text())
            if owner["owner_id"] != str(owner_id):
                raise ValueError
            if datetime.fromisoformat(owner["expires_at"]) < datetime.now(UTC):
                self.remove(path)
                raise ValueError
            return path
        except (OSError, ValueError, KeyError):
            raise NotFoundError("This backup expired. Generate or upload it again.") from None

    def remove(self, path: Path) -> None:
        resolved = path.resolve()
        if resolved.parent != self.directory or not resolved.name == str(UUID(resolved.name)):
            raise ValueError("Invalid backup cache directory")
        shutil.rmtree(resolved, ignore_errors=True)

    def expire(self) -> None:
        for path in self.directory.iterdir():
            try:
                UUID(path.name)
                owner = json.loads((path / "owner.json").read_text())
                if datetime.fromisoformat(owner["expires_at"]) < datetime.now(UTC):
                    self.remove(path)
            except (OSError, ValueError, KeyError):
                continue
