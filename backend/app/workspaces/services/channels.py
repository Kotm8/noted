from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import NotFoundError, ValidationError
from app.core.security import utc_now
from app.journals.models import JournalEntry
from app.notes.documents.models import ChannelDocument
from app.notes.models import Message
from app.publishing.models import ScheduledMessage
from app.workspaces.models import Channel, Workspace
from app.workspaces.repository import ChannelRepository
from app.workspaces.schemas import ChannelCreate
from app.workspaces.services.categories import CategoryService
from app.workspaces.services.workspaces import WorkspaceService


class ChannelService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.repository = ChannelRepository(db)
        self.workspaces = WorkspaceService(db)
        self.categories = CategoryService(db)

    def get_channel(self, channel_id: UUID, owner_id: UUID) -> Channel:
        channel = self.repository.get_by_id(channel_id)
        if channel is None:
            raise NotFoundError("Channel not found")
        self.workspaces.get_workspace(channel.workspace_id, owner_id)
        return channel

    def validate_category(
        self,
        category_id: UUID | None,
        workspace_id: UUID,
        owner_id: UUID,
    ) -> None:
        if category_id is None:
            return
        category = self.categories.get_category(category_id, owner_id)
        if category.workspace_id != workspace_id:
            raise ValidationError("The category must belong to this workspace")

    def list_channels(
        self,
        workspace_id: UUID,
        owner_id: UUID,
        limit: int,
        offset: int,
    ) -> list[Channel]:
        self.workspaces.get_workspace(workspace_id, owner_id)
        return self.repository.list_for_workspace(workspace_id, limit, offset)

    def list_all(self, owner_id: UUID) -> list[Channel]:
        return list(
            self.db.scalars(
                select(Channel)
                .join(Workspace)
                .where(Workspace.owner_id == owner_id)
                .order_by(Workspace.position, Workspace.created_at, Channel.position, Channel.id)
            )
        )

    def set_pinned(self, channel_id: UUID, pinned: bool, owner_id: UUID) -> Channel:
        channel = self.get_channel(channel_id, owner_id)
        if pinned != (channel.pinned_at is not None):
            channel.pinned_at = utc_now() if pinned else None
            self.db.commit()
            self.db.refresh(channel)
        return channel

    def create_channel(self, workspace_id: UUID, data: ChannelCreate, owner_id: UUID) -> Channel:
        self.workspaces.get_workspace(workspace_id, owner_id)
        self.validate_category(data.category_id, workspace_id, owner_id)
        channel = self.repository.create(
            workspace_id=workspace_id,
            category_id=data.category_id,
            name=data.name,
            position=data.position,
        )
        channel.kind = data.kind
        self.db.commit()
        self.db.refresh(channel)
        return channel

    def update_channel(self, channel_id: UUID, data: ChannelCreate, owner_id: UUID) -> Channel:
        channel = self.get_channel(channel_id, owner_id)
        self.db.refresh(channel, with_for_update=True)
        kind = data.kind if "kind" in data.model_fields_set else channel.kind
        if kind != channel.kind and self.db.scalar(
            select(ScheduledMessage.id)
            .where(ScheduledMessage.channel_id == channel_id, ScheduledMessage.status == "pending")
            .limit(1)
        ):
            raise ValidationError(
                "Cancel this channel's scheduled messages before changing its type."
            )
        if kind != channel.kind and {"journal", "document"}.intersection((kind, channel.kind)):
            notes = self.db.scalar(
                select(Message.id).where(Message.channel_id == channel_id).limit(1)
            )
            entries = self.db.scalar(
                select(JournalEntry.id).where(JournalEntry.channel_id == channel_id).limit(1)
            )
            document = self.db.get(ChannelDocument, channel_id)
            if notes or entries or document:
                raise ValidationError(
                    "Create a new channel to change its type while it contains content."
                )
        self.validate_category(data.category_id, channel.workspace_id, owner_id)
        channel.name = data.name
        channel.position = data.position
        channel.category_id = data.category_id
        if "kind" in data.model_fields_set:
            channel.kind = data.kind
        self.db.commit()
        self.db.refresh(channel)
        return channel

    def delete_channel(self, channel_id: UUID, owner_id: UUID) -> None:
        channel = self.get_channel(channel_id, owner_id)
        self.repository.delete(channel)
        self.db.commit()
