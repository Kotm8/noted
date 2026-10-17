from uuid import UUID

from fastapi import APIRouter, Depends, Request
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.auth.services.sessions import AuthenticatedSession
from app.backup.schemas import BackupPreview, ImportBackup, ImportResult
from app.backup.services.backup import BackupService
from app.dependencies.auth import get_current_session
from app.dependencies.database import get_db
from app.dependencies.storage import get_storage
from app.storage.base import FileStorage

router = APIRouter(prefix="/backups", tags=["backups"])


def get_backups(
    request: Request, db: Session = Depends(get_db), storage: FileStorage = Depends(get_storage)
) -> BackupService:
    return BackupService(db, storage, request.app.state.backups)


@router.post("/export", response_model=BackupPreview, status_code=201)
async def export_backup(
    current: AuthenticatedSession = Depends(get_current_session),
    service: BackupService = Depends(get_backups),
) -> BackupPreview:
    return await service.export(current.user.id)


@router.get("/{token}/download")
def download_backup(
    token: UUID,
    current: AuthenticatedSession = Depends(get_current_session),
    service: BackupService = Depends(get_backups),
) -> FileResponse:
    directory = service.cache.get(token, current.user.id)
    return FileResponse(
        directory / "backup.zip", media_type="application/zip", filename=f"noted-backup-{token}.zip"
    )


@router.post("/preview", response_model=BackupPreview)
async def preview_backup(
    request: Request,
    current: AuthenticatedSession = Depends(get_current_session),
    service: BackupService = Depends(get_backups),
) -> BackupPreview:
    return await service.upload(current.user.id, request)


@router.post("/import", response_model=ImportResult)
async def import_backup(
    data: ImportBackup,
    current: AuthenticatedSession = Depends(get_current_session),
    service: BackupService = Depends(get_backups),
) -> ImportResult:
    return await service.restore(current.user.id, data)
