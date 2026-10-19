from fastapi import APIRouter

from app.api.v1.endpoints import (
    android_notifications,
    attachments,
    auth,
    backups,
    categories,
    channel_banners,
    channels,
    documents,
    health,
    home,
    host,
    journals,
    messages,
    notifications,
    plan_prompts,
    publishing,
    reminders,
    schedule,
    search,
    settings,
    threads,
    time_tracking,
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
router.include_router(threads.router)
router.include_router(journals.router)
router.include_router(documents.router)
router.include_router(reminders.router)
router.include_router(notifications.router)
router.include_router(android_notifications.router)
router.include_router(health.router)
router.include_router(home.router)
router.include_router(host.router)
router.include_router(attachments.router)
router.include_router(workspace_icons.router)
router.include_router(search.router)
router.include_router(settings.router)
router.include_router(updates.router)

router.include_router(time_tracking.router)
router.include_router(schedule.router)
router.include_router(plan_prompts.router)
router.include_router(publishing.router)
