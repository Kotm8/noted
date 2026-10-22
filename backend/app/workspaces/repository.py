from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.workspaces.models import Category, Channel, Workspace


class WorkspaceRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get_for_owner(self, workspace_id: UUID, owner_id: UUID) -> Workspace | None:
        statement = select(Workspace).where(
            Workspace.id == workspace_id,
            Workspace.owner_id == owner_id,
        )
        return self.db.scalar(statement)

    def list_for_owner(self, owner_id: UUID, limit: int, offset: int) -> list[Workspace]:
        statement = (
            select(Workspace)
            .where(Workspace.owner_id == owner_id)
            .order_by(Workspace.position, Workspace.created_at, Workspace.id)
            .offset(offset)
            .limit(limit)
        )
        return list(self.db.scalars(statement))

    def create(self, owner_id: UUID, name: str, icon: str, position: int) -> Workspace:
        workspace = Workspace(owner_id=owner_id, name=name, icon=icon, position=position)
        self.db.add(workspace)
        self.db.flush()
        return workspace

    def delete(self, workspace: Workspace) -> None:
        self.db.delete(workspace)

    def lock_for_owner(self, workspace_id: UUID, owner_id: UUID) -> Workspace | None:
        return self.db.scalar(
            select(Workspace)
            .where(Workspace.id == workspace_id, Workspace.owner_id == owner_id)
            .with_for_update()
        )


class CategoryRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get_by_id(self, category_id: UUID) -> Category | None:
        return self.db.get(Category, category_id)

    def list_for_workspace(self, workspace_id: UUID, limit: int, offset: int) -> list[Category]:
        statement = (
            select(Category)
            .where(Category.workspace_id == workspace_id)
            .order_by(Category.position, Category.id)
            .offset(offset)
            .limit(limit)
        )
        return list(self.db.scalars(statement))

    def create(self, workspace_id: UUID, name: str, position: int) -> Category:
        category = Category(workspace_id=workspace_id, name=name, position=position)
        self.db.add(category)
        self.db.flush()
        return category

    def delete(self, category: Category) -> None:
        self.db.delete(category)

    def lock_for_workspace(self, workspace_id: UUID) -> list[Category]:
        return list(
            self.db.scalars(
                select(Category)
                .where(Category.workspace_id == workspace_id)
                .order_by(Category.position, Category.id)
                .with_for_update()
            )
        )


class ChannelRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get_by_id(self, channel_id: UUID) -> Channel | None:
        return self.db.get(Channel, channel_id)

    def list_for_workspace(self, workspace_id: UUID, limit: int, offset: int) -> list[Channel]:
        statement = (
            select(Channel)
            .where(Channel.workspace_id == workspace_id)
            .order_by(Channel.position, Channel.created_at, Channel.id)
            .offset(offset)
            .limit(limit)
        )
        return list(self.db.scalars(statement))

    def create(
        self,
        workspace_id: UUID,
        category_id: UUID | None,
        name: str,
        position: int,
    ) -> Channel:
        channel = Channel(
            workspace_id=workspace_id,
            category_id=category_id,
            name=name,
            position=position,
        )
        self.db.add(channel)
        self.db.flush()
        return channel

    def delete(self, channel: Channel) -> None:
        self.db.delete(channel)

    def lock_for_workspace(self, workspace_id: UUID) -> list[Channel]:
        return list(
            self.db.scalars(
                select(Channel)
                .where(Channel.workspace_id == workspace_id)
                .order_by(Channel.position, Channel.created_at, Channel.id)
                .with_for_update()
            )
        )
