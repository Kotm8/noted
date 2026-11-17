from datetime import date
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.auth.services.sessions import AuthenticatedSession
from app.dependencies.auth import get_current_session
from app.dependencies.database import get_db
from app.dependencies.storage import get_storage
from app.finance.assets import store_asset
from app.finance.imports import ImportInput, import_picture
from app.finance.recurrence import advance_owner, today_for
from app.finance.repository import FinanceRepository
from app.finance.schemas import FinanceAction
from app.finance.service import FinanceService
from app.storage.base import FileStorage

router = APIRouter(prefix="/finance", tags=["finance"])


@router.get("")
def board(
    month: date | None = None,
    search: str = Query(default="", max_length=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> dict[str, Any]:
    result = FinanceService(db).board(
        current.user.id, month or today_for(db, current.user.id), search, offset
    )
    result["today"] = today_for(db, current.user.id).isoformat()
    db.commit()
    return result


@router.post("/actions")
def change(
    data: FinanceAction,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> dict[str, Any]:
    result = FinanceService(db).execute(current.user.id, data)
    if data.entity == "payment":
        advance_owner(db, current.user.id)
    db.commit()
    return result


@router.post("/photos", status_code=201)
async def upload_photo(
    file: UploadFile,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
    storage: FileStorage = Depends(get_storage),
) -> dict[str, Any]:
    photo = await store_asset(db, storage, current.user.id, file)
    try:
        db.commit()
    except BaseException:
        db.rollback()
        await storage.delete(photo.storage_key)
        raise
    return {"id": str(photo.id), "filename": photo.filename}


@router.get("/photos/{photo_id}")
def photo(
    photo_id: UUID,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
    storage: FileStorage = Depends(get_storage),
) -> StreamingResponse:
    row = FinanceRepository(db).get(current.user.id, "asset", photo_id)
    return StreamingResponse(
        storage.read(row.storage_key),
        media_type=row.content_type,
        headers={"Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff"},
    )


@router.post("/imports")
async def import_spending(
    data: ImportInput,
    request: Request,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
    storage: FileStorage = Depends(get_storage),
) -> dict[str, Any]:
    return await import_picture(
        db, storage, request.app.state.settings.storage_path, current.user.id, data
    )
