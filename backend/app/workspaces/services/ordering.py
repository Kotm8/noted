from uuid import UUID

from sqlalchemy.orm import Session

from app.core.errors import NotFoundError, ValidationError
from app.workspaces.models import Category, Channel
from app.workspaces.repository import CategoryRepository, ChannelRepository, WorkspaceRepository
from app.workspaces.schemas import CategoryResponse, ChannelResponse, SidebarMove, SidebarOrder


def place_before[T: Category | Channel](items: list[T], item: T, before_id: UUID | None) -> None:
    remaining = [entry for entry in items if entry.id != item.id]
    if before_id == item.id:
        return
    index = next((i for i, entry in enumerate(remaining) if entry.id == before_id), None)
    if before_id is not None and index is None:
        raise ValidationError("The destination changed. Refresh the sidebar and try again.")
    remaining.insert(len(remaining) if index is None else index, item)
    for position, entry in enumerate(remaining):
        entry.position = position


class SidebarOrderService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def move(self, workspace_id: UUID, owner_id: UUID, data: SidebarMove) -> SidebarOrder:
        if WorkspaceRepository(self.db).lock_for_owner(workspace_id, owner_id) is None:
            raise NotFoundError("Workspace not found")
        categories = CategoryRepository(self.db).lock_for_workspace(workspace_id)
        channels = ChannelRepository(self.db).lock_for_workspace(workspace_id)
        if data.kind == "category":
            category = next((item for item in categories if item.id == data.id), None)
            if category is None:
                raise NotFoundError("Category not found")
            if data.category_id is not None:
                raise ValidationError("Categories cannot be nested")
            place_before(categories, category, data.before_id)
        else:
            channel = next((item for item in channels if item.id == data.id), None)
            if channel is None:
                raise NotFoundError("Channel not found")
            if data.category_id is not None and not any(
                item.id == data.category_id for item in categories
            ):
                raise ValidationError("The destination category is not in this workspace")
            group = [item for item in channels if item.category_id == data.category_id]
            if data.before_id == channel.id and channel.category_id != data.category_id:
                raise ValidationError("The destination channel is not in this category")
            place_before(group, channel, data.before_id)
            channel.category_id = data.category_id
        self.db.commit()
        return SidebarOrder(
            categories=[
                CategoryResponse.model_validate(item)
                for item in sorted(categories, key=lambda item: (item.position, item.id))
            ],
            channels=[
                ChannelResponse.model_validate(item)
                for item in sorted(
                    channels, key=lambda item: (item.position, item.created_at, item.id)
                )
            ],
        )
