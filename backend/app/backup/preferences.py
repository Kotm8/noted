from typing import TYPE_CHECKING
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.ai.models import AiPrompt
from app.ai.schemas import AiPreferences, PromptInput
from app.auth.models import User
from app.auth.schemas import AppearancePreferences
from app.notifications.schemas import NotificationSettings
from app.time_tracking.models import TrackerState
from app.time_tracking.schemas import TrackingPreferences
from app.wear.schemas import WatchSettings

if TYPE_CHECKING:
    from app.backup.schemas import BackupContent


class BackupPreferences(BaseModel):
    model_config = ConfigDict(extra="forbid")
    appearance: AppearancePreferences | None = None
    notifications: NotificationSettings | None = None
    watch: WatchSettings | None = None
    ai: AiPreferences | None = None
    tracking: TrackingPreferences | None = None
    prompts: list[PromptInput] = Field(default_factory=list, max_length=200)


def export_preferences(db: Session, owner_id: UUID) -> dict[str, object] | None:
    user = db.get(User, owner_id)
    if user is None:
        return None
    values = {
        "appearance": user.appearance,
        "notifications": user.notification_preferences,
        "watch": user.watch_preferences,
        "ai": user.ai_preferences,
    }
    state = db.get(TrackerState, owner_id)
    tracking = (
        TrackingPreferences.model_validate(
            {name: getattr(state, name) for name in TrackingPreferences.model_fields}
        )
        if state
        else None
    )
    prompts = list(
        db.scalars(
            select(AiPrompt)
            .where(AiPrompt.owner_id == owner_id)
            .order_by(AiPrompt.position, AiPrompt.id)
        )
    )
    data = BackupPreferences.model_validate(
        {
            **values,
            "tracking": tracking if tracking != TrackingPreferences() else None,
            "prompts": [
                {name: getattr(prompt, name) for name in PromptInput.model_fields}
                for prompt in prompts
            ],
        }
    )
    result = data.model_dump(mode="json", exclude_none=True)
    if result == {"prompts": []}:
        return None
    return result


def restore_preferences(
    db: Session, owner_id: UUID, data: "BackupContent", identifiers: dict[UUID, UUID]
) -> None:
    settings = data.preferences
    if settings is None:
        return
    user = db.get(User, owner_id)
    if user is None:
        return
    for name, field in (
        ("appearance", "appearance"),
        ("notifications", "notification_preferences"),
        ("ai", "ai_preferences"),
    ):
        value = getattr(settings, name)
        if value is not None:
            setattr(user, field, value.model_dump(by_alias=name == "appearance"))
    if settings.watch is not None:
        watch = settings.watch.model_dump(mode="json")
        watch["favorites"] = [
            str(identifiers[item]) for item in settings.watch.favorites if item in identifiers
        ]
        user.watch_preferences = watch
    if settings.tracking is not None:
        state = db.get(TrackerState, owner_id)
        if state is None:
            state = TrackerState(owner_id=owner_id)
            db.add(state)
        for name, value in settings.tracking.model_dump(mode="json").items():
            setattr(state, name, value)
        state.revision = (state.revision or 0) + 1
    db.execute(delete(AiPrompt).where(AiPrompt.owner_id == owner_id))
    for position, prompt in enumerate(settings.prompts):
        db.add(AiPrompt(owner_id=owner_id, position=position, **prompt.model_dump()))
