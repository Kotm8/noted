from uuid import UUID

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from starlette.datastructures import UploadFile

from app.auth.services.sessions import AuthenticatedSession
from app.core.errors import ValidationError
from app.dependencies.auth import get_current_session
from app.dependencies.database import get_db
from app.dependencies.storage import get_storage
from app.storage.base import FileStorage
from app.workspaces.models import Channel
from app.workspaces.schemas import ChannelResponse
from app.workspaces.services.banners import ChannelBannerService

router = APIRouter(tags=["channel images"])


@router.put("/channels/{channel_id}/banner", response_model=ChannelResponse)
async def set_channel_banner(
    channel_id: UUID,
    request: Request,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
    storage: FileStorage = Depends(get_storage),
) -> Channel:
    async with request.form(max_files=1, max_fields=0) as form:
        file = form.get("file")
        if not isinstance(file, UploadFile):
            raise ValidationError("Choose an image or GIF.")
        return await ChannelBannerService(db, storage).set_banner(channel_id, current.user.id, file)


@router.delete("/channels/{channel_id}/banner", response_model=ChannelResponse)
async def clear_channel_banner(
    channel_id: UUID,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
    storage: FileStorage = Depends(get_storage),
) -> Channel:
    return await ChannelBannerService(db, storage).clear_banner(channel_id, current.user.id)


@router.get("/channels/{channel_id}/banner")
async def get_channel_banner(
    channel_id: UUID,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
    storage: FileStorage = Depends(get_storage),
) -> StreamingResponse:
    channel = await ChannelBannerService(db, storage).get_banner(channel_id, current.user.id)
    return StreamingResponse(
        storage.read(channel.banner_storage_key or ""),
        media_type=channel.banner_content_type,
        headers={"Content-Length": str(channel.banner_size or 0)},
    )
