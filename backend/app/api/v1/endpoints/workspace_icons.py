from uuid import UUID

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from starlette.datastructures import UploadFile

from app.auth.services.sessions import AuthenticatedSession
from app.core.errors import ValidationError
from app.core.middleware import IMMUTABLE_CACHE
from app.dependencies.auth import get_current_session
from app.dependencies.database import get_db
from app.dependencies.storage import get_storage
from app.storage.base import FileStorage
from app.workspaces.models import Workspace
from app.workspaces.schemas import WorkspaceResponse
from app.workspaces.services.icons import WorkspaceIconService

router = APIRouter(tags=["workspace images"])


@router.put("/workspaces/{workspace_id}/icon", response_model=WorkspaceResponse)
async def set_workspace_icon(
    workspace_id: UUID,
    request: Request,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
    storage: FileStorage = Depends(get_storage),
) -> Workspace:
    async with request.form(max_files=1, max_fields=0) as form:
        file = form.get("file")
        if not isinstance(file, UploadFile):
            raise ValidationError("Choose an image or GIF.")
        return await WorkspaceIconService(db, storage).set_icon(workspace_id, current.user.id, file)


@router.delete("/workspaces/{workspace_id}/icon", response_model=WorkspaceResponse)
async def clear_workspace_icon(
    workspace_id: UUID,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
    storage: FileStorage = Depends(get_storage),
) -> Workspace:
    return await WorkspaceIconService(db, storage).clear_icon(workspace_id, current.user.id)


@router.get("/workspaces/{workspace_id}/icon")
async def get_workspace_icon(
    workspace_id: UUID,
    v: str | None = None,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
    storage: FileStorage = Depends(get_storage),
) -> StreamingResponse:
    workspace = await WorkspaceIconService(db, storage).get_icon(workspace_id, current.user.id)
    key = workspace.icon_storage_key or ""
    # Only the versioned address apps use is kept; a bare or outdated one must keep
    # showing whichever icon is current.
    current_version = v is not None and v == key.split("/")[-1]
    return StreamingResponse(
        storage.read(key),
        media_type=workspace.icon_content_type,
        headers={
            "Content-Length": str(workspace.icon_size or 0),
            "Cache-Control": IMMUTABLE_CACHE if current_version else "no-store",
        },
    )
