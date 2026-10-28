import json
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from app.auth.models import User
from app.core.config import Settings
from app.core.security import utc_now
from app.notifications.routing import deliver
from app.notifications.schemas import NotificationSettings
from app.publishing.models import WritingDelivery, WritingPrompt
from app.workspaces.models import Channel, Workspace


def dispatch_writing(engine: Engine, settings: Settings, started: datetime) -> None:
    now = utc_now()
    with Session(engine) as db:
        prompts = db.scalars(
            select(WritingPrompt)
            .where(
                WritingPrompt.enabled.is_(True),
                WritingPrompt.due_at >= max(started, now - timedelta(minutes=5)),
                WritingPrompt.due_at <= now,
            )
            .limit(50)
            .with_for_update(skip_locked=True)
        ).all()
        for prompt in prompts:
            user = db.get(User, prompt.owner_id)
            channel = db.get(Channel, prompt.channel_id)
            project = db.get(Workspace, channel.workspace_id) if channel else None
            if user is None or channel is None or project is None:
                continue
            preferences = NotificationSettings.model_validate(user.notification_preferences or {})
            if not preferences.enabled:
                continue
            payload = json.dumps(
                {
                    "kind": "writing",
                    "writingPromptId": str(prompt.id),
                    "revision": prompt.revision,
                    "title": f"{project.name} / #{channel.name}",
                    "body": prompt.content,
                    "url": f"/w/{project.id}/c/{channel.id}",
                },
                ensure_ascii=False,
            )

            deliver(
                db,
                WritingDelivery,
                prompt.id,
                prompt.revision,
                user.id,
                preferences,
                payload,
                origin=settings.app_origin,
                settings=settings,
                max_attempts=4,
                ttl=300,
            )
        db.commit()
