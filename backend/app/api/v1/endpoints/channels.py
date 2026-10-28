from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.auth.services.sessions import AuthenticatedSession
from app.dependencies.auth import get_current_session
from app.dependencies.database import get_db
from app.workspaces.models import Channel
from app.workspaces.schemas import ChannelCreate, ChannelPin, ChannelResponse
from app.workspaces.services.channels import ChannelService

router = APIRouter(tags=["channels"])


@router.get("/workspaces/{workspace_id}/channels", response_model=list[ChannelResponse])
def list_channels(
    workspace_id: UUID,
    limit: int = Query(default=100, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> list[Channel]:
    return ChannelService(db).list_channels(workspace_id, current.user.id, limit, offset)


@router.get("/channels", response_model=list[ChannelResponse])
def list_all_channels(
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> list[Channel]:
    return ChannelService(db).list_all(current.user.id)


@router.put("/channels/{channel_id}/pin", response_model=ChannelResponse)
def pin_channel(
    channel_id: UUID,
    data: ChannelPin,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> Channel:
    return ChannelService(db).set_pinned(channel_id, data.pinned, current.user.id)


@router.post("/workspaces/{workspace_id}/channels", response_model=ChannelResponse, status_code=201)
def create_channel(
    workspace_id: UUID,
    data: ChannelCreate,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> Channel:
    return ChannelService(db).create_channel(workspace_id, data, current.user.id)


@router.put("/channels/{channel_id}", response_model=ChannelResponse)
def update_channel(
    channel_id: UUID,
    data: ChannelCreate,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> Channel:
    return ChannelService(db).update_channel(channel_id, data, current.user.id)


@router.delete("/channels/{channel_id}", status_code=204)
def delete_channel(
    channel_id: UUID,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> None:
    ChannelService(db).delete_channel(channel_id, current.user.id)
