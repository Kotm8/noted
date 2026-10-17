from uuid import UUID

from sqlalchemy.orm import Session

from app.core.errors import NotFoundError
from app.workspaces.models import Category
from app.workspaces.repository import CategoryRepository
from app.workspaces.schemas import CategoryCreate
from app.workspaces.services.workspaces import WorkspaceService


class CategoryService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.repository = CategoryRepository(db)
        self.workspaces = WorkspaceService(db)

    def get_category(self, category_id: UUID, owner_id: UUID) -> Category:
        category = self.repository.get_by_id(category_id)
        if category is None:
            raise NotFoundError("Category not found")
        self.workspaces.get_workspace(category.workspace_id, owner_id)
        return category

    def list_categories(
        self,
        workspace_id: UUID,
        owner_id: UUID,
        limit: int,
        offset: int,
    ) -> list[Category]:
        self.workspaces.get_workspace(workspace_id, owner_id)
        return self.repository.list_for_workspace(workspace_id, limit, offset)

    def create_category(self, workspace_id: UUID, data: CategoryCreate, owner_id: UUID) -> Category:
        self.workspaces.get_workspace(workspace_id, owner_id)
        category = self.repository.create(workspace_id, data.name, data.position)
        self.db.commit()
        self.db.refresh(category)
        return category

    def update_category(self, category_id: UUID, data: CategoryCreate, owner_id: UUID) -> Category:
        category = self.get_category(category_id, owner_id)
        category.name = data.name
        category.position = data.position
        self.db.commit()
        self.db.refresh(category)
        return category

    def delete_category(self, category_id: UUID, owner_id: UUID) -> None:
        category = self.get_category(category_id, owner_id)
        self.repository.delete(category)
        self.db.commit()
