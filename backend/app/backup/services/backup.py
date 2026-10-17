import hashlib
import json
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID

from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool
from starlette.requests import Request

from app.backup.schemas import BackupContent, BackupPreview, ImportBackup, ImportResult
from app.backup.services.archive import counts, validate_archive
from app.backup.services.cache import LIFETIME, BackupCache
from app.backup.services.exporter import BackupExporter
from app.backup.services.importer import BackupImporter
from app.core.errors import ContentTooLargeError, ValidationError
from app.core.storage_limits import MAX_ARCHIVE
from app.storage.base import FileStorage


class BackupService:
    def __init__(self, db: Session, storage: FileStorage, cache: BackupCache) -> None:
        self.db, self.storage, self.cache = db, storage, cache

    async def export(self, owner_id: UUID) -> BackupPreview:
        with self.cache.operation(owner_id):
            return await self.export_unlocked(owner_id)

    async def export_unlocked(self, owner_id: UUID) -> BackupPreview:
        token, directory = self.cache.create(owner_id)
        try:
            data = await BackupExporter(self.db, self.storage).create(
                owner_id, directory / "backup.zip"
            )
            return self.preview(token, directory, data, download=True)
        except BaseException:
            self.cache.remove(directory)
            raise

    def preview(
        self, token: UUID, directory: Path, data: BackupContent, download: bool = False
    ) -> BackupPreview:
        return BackupPreview(
            token=token,
            created_at=data.created_at,
            expires_at=datetime.now(UTC) + LIFETIME,
            size=(directory / "backup.zip").stat().st_size,
            counts=counts(data),
            download_url=f"/api/v1/backups/{token}/download" if download else None,
        )

    async def upload(self, owner_id: UUID, request: Request) -> BackupPreview:
        with self.cache.operation(owner_id):
            return await self.upload_unlocked(owner_id, request)

    async def upload_unlocked(self, owner_id: UUID, request: Request) -> BackupPreview:
        token, directory = self.cache.create(owner_id)
        try:
            size = 0
            digest = hashlib.sha256()
            with (directory / "backup.zip").open("xb") as file:
                async for chunk in request.stream():
                    size += len(chunk)
                    if size > MAX_ARCHIVE:
                        raise ContentTooLargeError("Backups must be no larger than 1 GB.")
                    digest.update(chunk)
                    file.write(chunk)
            with tempfile.TemporaryDirectory(prefix="checked-", dir=directory) as checked:
                data = await run_in_threadpool(
                    validate_archive, directory / "backup.zip", Path(checked)
                )
            (directory / "validated.json").write_text(json.dumps({"sha256": digest.hexdigest()}))
            return self.preview(token, directory, data)
        except BaseException:
            self.cache.remove(directory)
            raise

    async def restore(self, owner_id: UUID, request: ImportBackup) -> ImportResult:
        with self.cache.operation(owner_id):
            return await self.restore_unlocked(owner_id, request)

    async def restore_unlocked(self, owner_id: UUID, request: ImportBackup) -> ImportResult:
        if request.mode == "replace" and request.confirmation != "REPLACE MY NOTES":
            raise ValidationError("Type REPLACE MY NOTES to replace existing content.")
        directory = self.cache.get(request.token, owner_id)
        marker = directory / "import.lock"
        try:
            with marker.open("x"):
                pass
        except FileExistsError:
            raise ValidationError("This backup is already being imported.") from None
        try:
            if not (directory / "validated.json").is_file():
                raise ValidationError("Upload and preview the ZIP before importing it.")

            def unchanged() -> bool:
                expected = json.loads((directory / "validated.json").read_text())["sha256"]
                with (directory / "backup.zip").open("rb") as file:
                    return (
                        isinstance(expected, str)
                        and hashlib.file_digest(file, "sha256").hexdigest() == expected
                    )

            if not await run_in_threadpool(unchanged):
                raise ValidationError("The uploaded ZIP changed after preview. Upload it again.")
            with tempfile.TemporaryDirectory(prefix="verified-", dir=directory) as temporary:
                data = await run_in_threadpool(
                    validate_archive, directory / "backup.zip", Path(temporary)
                )
                await BackupImporter(self.db, self.storage).restore(
                    data, Path(temporary), owner_id, request.mode == "replace"
                )
                result = ImportResult(counts=counts(data))
            self.cache.remove(directory)
            return result
        finally:
            marker.unlink(missing_ok=True)
