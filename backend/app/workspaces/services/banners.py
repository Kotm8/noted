import logging
from uuid import UUID

from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import UploadFile

from app.core.errors import NotFoundError
from app.storage.base import FileStorage
from app.storage.uploads import UploadService
from app.workspaces.models import Channel
from app.workspaces.services.channels import ChannelService
from app.workspaces.services.icon_images import normalize_icon

logger = logging.getLogger(__name__)


class ChannelBannerService:
    def __init__(self, db: Session, storage: FileStorage) -> None:
        self.db = db
        self.storage = storage
        self.channels = ChannelService(db)

    async def set_banner(self, channel_id: UUID, owner_id: UUID, file: UploadFile) -> Channel:
        channel = self.channels.get_channel(channel_id, owner_id)
        normalized = await run_in_threadpool(normalize_icon, file, (512, 256))
        try:
            saved = await UploadService(self.storage).save(normalized, image_only=True)
        finally:
            await normalized.close()
        previous_key = channel.banner_storage_key
        try:
            channel.banner_storage_key = saved.key
            channel.banner_content_type = saved.content_type
            channel.banner_size = saved.size
            self.db.commit()
        except BaseException:
            self.db.rollback()
            await self.storage.delete(saved.key)
            raise
        self.db.refresh(channel)
        if previous_key:
            await self.remove_previous(previous_key)
        return channel

    async def clear_banner(self, channel_id: UUID, owner_id: UUID) -> Channel:
        channel = self.channels.get_channel(channel_id, owner_id)
        previous_key = channel.banner_storage_key
        channel.banner_storage_key = None
        channel.banner_content_type = None
        channel.banner_size = None
        self.db.commit()
        self.db.refresh(channel)
        if previous_key:
            await self.remove_previous(previous_key)
        return channel

    async def get_banner(self, channel_id: UUID, owner_id: UUID) -> Channel:
        channel = self.channels.get_channel(channel_id, owner_id)
        if not channel.banner_storage_key or not await self.storage.exists(
            channel.banner_storage_key
        ):
            raise NotFoundError("Channel image not found")
        return channel

    async def remove_previous(self, key: str) -> None:
        try:
            await self.storage.delete(key)
        except OSError:
            logger.warning("A replaced channel image could not be removed from storage.")
