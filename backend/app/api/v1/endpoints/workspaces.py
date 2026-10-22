from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.auth.services.sessions import AuthenticatedSession
from app.dependencies.auth import get_current_session
from app.dependencies.database import get_db
from app.workspaces.models import Workspace
from app.workspaces.schemas import SidebarMove, SidebarOrder, WorkspaceCreate, WorkspaceResponse
from app.workspaces.services.ordering import SidebarOrderService
from app.workspaces.services.workspaces import WorkspaceService

router = APIRouter(tags=["workspaces"])


@router.put("/workspaces/{workspace_id}/order", response_model=SidebarOrder)
def move_sidebar_item(
    workspace_id: UUID,
    data: SidebarMove,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> SidebarOrder:
    return SidebarOrderService(db).move(workspace_id, current.user.id, data)


@router.get("/workspaces", response_model=list[WorkspaceResponse])
def list_workspaces(
    limit: int = Query(default=100, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> list[Workspace]:
    return WorkspaceService(db).list_workspaces(current.user.id, limit, offset)


@router.post("/workspaces", response_model=WorkspaceResponse, status_code=201)
def create_workspace(
    data: WorkspaceCreate,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> Workspace:
    return WorkspaceService(db).create_workspace(data, current.user.id)


@router.put("/workspaces/{workspace_id}", response_model=WorkspaceResponse)
def update_workspace(
    workspace_id: UUID,
    data: WorkspaceCreate,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> Workspace:
    return WorkspaceService(db).update_workspace(workspace_id, data, current.user.id)


@router.delete("/workspaces/{workspace_id}", status_code=204)
def delete_workspace(
    workspace_id: UUID,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> None:
    WorkspaceService(db).delete_workspace(workspace_id, current.user.id)
