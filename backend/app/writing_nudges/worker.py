import json
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from app.auth.models import User
from app.core.config import Settings
from app.notifications.routing import deliver
from app.notifications.schemas import NotificationSettings
from app.workspaces.models import Channel, Workspace
from app.writing_nudges.models import NudgeDelivery, WritingNudge, WritingNudgeRun
from app.writing_nudges.service import NudgeService


def advance_nudges(engine: Engine, now: datetime) -> None:
    with Session(engine) as db:
        service = NudgeService(db)
        runs = db.scalars(
            select(WritingNudgeRun)
            .where(WritingNudgeRun.next_at <= now)
            .order_by(WritingNudgeRun.next_at)
            .limit(100)
            .with_for_update(skip_locked=True)
        ).all()
        for run in runs:
            service.consume(run, now)
            service.notify(run, now)
            run.remaining_seconds = run.settings["interval_minutes"] * 60
            service.resume(run.owner_id, now)
        db.commit()


def dispatch_nudges(engine: Engine, settings: Settings) -> None:
    with Session(engine) as db:
        items = db.execute(
            select(WritingNudge, User, Channel, Workspace)
            .join(User, User.id == WritingNudge.owner_id)
            .join(Channel, Channel.id == WritingNudge.channel_id)
            .join(Workspace, Workspace.id == Channel.workspace_id)
            .where(WritingNudge.completed_at.is_(None))
            .order_by(WritingNudge.due_at)
            .limit(100)
            .with_for_update(of=WritingNudge, skip_locked=True)
        ).all()
        for item, user, channel, project in items:
            preferences = NotificationSettings.model_validate(user.notification_preferences or {})
            if not preferences.enabled:
                continue
            payload = json.dumps(
                {
                    "kind": "writing",
                    "writingPromptId": str(item.id),
                    "revision": item.revision,
                    "title": f"{project.name} / #{channel.name}",
                    "body": item.content,
                    "url": f"/w/{project.id}/c/{channel.id}?write=1",
                },
                ensure_ascii=False,
            )
            deliver(
                db,
                NudgeDelivery,
                item.id,
                item.revision,
                user.id,
                preferences,
                payload,
                origin=settings.app_origin,
                settings=settings,
                max_attempts=4,
                ttl=3600,
            )
        db.commit()
