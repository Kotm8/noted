import logging
from uuid import UUID

from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import UploadFile

from app.core.errors import NotFoundError
from app.storage.base import FileStorage
from app.storage.uploads import UploadService
from app.workspaces.models import Workspace
from app.workspaces.services.icon_images import normalize_icon
from app.workspaces.services.workspaces import WorkspaceService

logger = logging.getLogger(__name__)


class WorkspaceIconService:
    def __init__(self, db: Session, storage: FileStorage) -> None:
        self.db = db
        self.storage = storage
        self.workspaces = WorkspaceService(db)

    async def set_icon(self, workspace_id: UUID, owner_id: UUID, file: UploadFile) -> Workspace:
        workspace = self.workspaces.get_workspace(workspace_id, owner_id)
        normalized = await run_in_threadpool(normalize_icon, file)
        try:
            saved = await UploadService(self.storage).save(normalized, image_only=True)
        finally:
            await normalized.close()
        previous_key = workspace.icon_storage_key

        try:
            workspace.icon_storage_key = saved.key
            workspace.icon_content_type = saved.content_type
            workspace.icon_size = saved.size
            self.db.commit()
        except BaseException:
            self.db.rollback()
            await self.storage.delete(saved.key)
            raise

        self.db.refresh(workspace)
        if previous_key:
            await self._remove_previous(previous_key)
        return workspace

    async def clear_icon(self, workspace_id: UUID, owner_id: UUID) -> Workspace:
        workspace = self.workspaces.get_workspace(workspace_id, owner_id)
        previous_key = workspace.icon_storage_key
        workspace.icon_storage_key = None
        workspace.icon_content_type = None
        workspace.icon_size = None
        self.db.commit()
        self.db.refresh(workspace)
        if previous_key:
            await self._remove_previous(previous_key)
        return workspace

    async def get_icon(self, workspace_id: UUID, owner_id: UUID) -> Workspace:
        workspace = self.workspaces.get_workspace(workspace_id, owner_id)
        if not workspace.icon_storage_key or not await self.storage.exists(
            workspace.icon_storage_key
        ):
            raise NotFoundError("Workspace image not found")
        return workspace

    async def _remove_previous(self, key: str) -> None:
        try:
            await self.storage.delete(key)
        except OSError:
            logger.warning("A replaced workspace image could not be removed from storage.")
