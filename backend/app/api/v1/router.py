from fastapi import APIRouter

from app.api.v1.endpoints import (
    attachments,
    auth,
    backups,
    categories,
    channel_banners,
    channels,
    health,
    host,
    messages,
    notifications,
    reminders,
    search,
    settings,
    updates,
    workspace_icons,
    workspaces,
)

router = APIRouter(prefix="/api/v1")

router.include_router(auth.router)
router.include_router(backups.router)
router.include_router(workspaces.router)
router.include_router(categories.router)
router.include_router(channels.router)
router.include_router(channel_banners.router)
router.include_router(messages.router)
router.include_router(reminders.router)
router.include_router(notifications.router)
router.include_router(health.router)
router.include_router(host.router)
router.include_router(attachments.router)
router.include_router(workspace_icons.router)
router.include_router(search.router)
router.include_router(settings.router)
router.include_router(updates.router)
