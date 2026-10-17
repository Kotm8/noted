from uuid import UUID

from sqlalchemy.orm import Session

from app.core.errors import NotFoundError
from app.workspaces.models import Workspace
from app.workspaces.repository import WorkspaceRepository
from app.workspaces.schemas import WorkspaceCreate


class WorkspaceService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.repository = WorkspaceRepository(db)

    def get_workspace(self, workspace_id: UUID, owner_id: UUID) -> Workspace:
        workspace = self.repository.get_for_owner(workspace_id, owner_id)
        if workspace is None:
            raise NotFoundError("Workspace not found")
        return workspace

    def list_workspaces(self, owner_id: UUID, limit: int, offset: int) -> list[Workspace]:
        return self.repository.list_for_owner(owner_id, limit, offset)

    def create_workspace(self, data: WorkspaceCreate, owner_id: UUID) -> Workspace:
        workspace = self.repository.create(owner_id, data.name, data.icon, data.position)
        self.db.commit()
        self.db.refresh(workspace)
        return workspace

    def update_workspace(
        self,
        workspace_id: UUID,
        data: WorkspaceCreate,
        owner_id: UUID,
    ) -> Workspace:
        workspace = self.get_workspace(workspace_id, owner_id)
        workspace.name = data.name
        workspace.icon = data.icon
        workspace.position = data.position
        self.db.commit()
        self.db.refresh(workspace)
        return workspace

    def delete_workspace(self, workspace_id: UUID, owner_id: UUID) -> None:
        workspace = self.get_workspace(workspace_id, owner_id)
        self.repository.delete(workspace)
        self.db.commit()
