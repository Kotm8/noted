import json

from sqlalchemy import select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from app.auth.models import User
from app.core.config import Settings
from app.core.security import utc_now
from app.notifications.routing import deliver
from app.notifications.schemas import NotificationSettings
from app.schedule.models import SchedulePlan
from app.schedule.prompts.models import PlanPrompt, PlanPromptDelivery
from app.schedule.prompts.service import refresh_prompts
from app.time_tracking.models import Activity


def dispatch_plan_prompts(engine: Engine, origin: str, settings: Settings | None) -> None:
    with Session(engine) as db:
        owners = db.scalars(
            select(SchedulePlan.owner_id).where(SchedulePlan.deleted_at.is_(None)).distinct()
        ).all()
        for owner_id in owners:
            refresh_prompts(db, owner_id)
            db.commit()
        prompts = db.scalars(
            select(PlanPrompt)
            .where(PlanPrompt.status == "pending", PlanPrompt.notify_at <= utc_now())
            .order_by(PlanPrompt.notify_at)
            .limit(50)
            .with_for_update(skip_locked=True)
        ).all()
        groups: dict[tuple[object, ...], list[PlanPrompt]] = {}
        for prompt in prompts:
            key = (
                (prompt.owner_id, prompt.planned_start, prompt.notify_at)
                if prompt.phase == "start"
                else (prompt.id,)
            )
            groups.setdefault(key, []).append(prompt)
        for group in groups.values():
            group.sort(key=lambda item: (item.title, str(item.id)))
            deliver_group(db, group, origin, settings)
        db.commit()


def either(names: list[str]) -> str:
    return names[0] if len(names) == 1 else f"{', '.join(names[:-1])} or {names[-1]}"


def deliver_group(
    db: Session, group: list[PlanPrompt], origin: str, settings: Settings | None
) -> None:
    """Plans starting at the same moment share one notification that offers each of them."""
    prompt, others = group[0], group[1:]
    user = db.get(User, prompt.owner_id)
    activity = db.get(Activity, prompt.activity_id)
    if user is None or activity is None or activity.archived:
        return
    preferences = NotificationSettings.model_validate(user.notification_preferences or {})
    if not preferences.enabled:
        return
    plan = db.get(SchedulePlan, prompt.plan_id)
    alternatives: list[dict[str, str | int]] = []
    for other in others:
        other_activity = db.get(Activity, other.activity_id)
        if other_activity is None or other_activity.archived:
            continue
        alternatives.append(
            {
                "promptId": str(other.id),
                "revision": other.revision,
                "activityId": str(other_activity.id),
                "activityName": other_activity.name,
                "title": other.title,
            }
        )
    switch = db.get(Activity, prompt.switch_activity_id) if prompt.switch_activity_id else None
    names = [activity.name, *(str(item["activityName"]) for item in alternatives)]
    if prompt.phase == "end":
        title = f"{activity.name} has ended"
        body = (
            f"{prompt.title}. Switch to {switch.name}, stop tracking, or snooze."
            if switch
            else f"{prompt.title}. Stop tracking or snooze to keep going."
        )
    else:
        title = f"Time for {either(names)}"
        body = " · ".join([prompt.title, *(str(item["title"]) for item in alternatives)])
    payload = json.dumps(
        {
            "kind": "plan",
            "phase": prompt.phase,
            "snoozeMinutes": preferences.snooze_minutes
            if preferences.snooze_minutes in {5, 10, 15, 30, 60}
            else 5,
            "promptId": str(prompt.id),
            "revision": prompt.revision,
            "activityId": str(activity.id),
            "activityName": activity.name,
            "title": title,
            "body": body,
            "alternatives": alternatives,
            "switchActivityId": str(switch.id) if switch else None,
            "switchActivityName": switch.name if switch else None,
            "switchTitle": prompt.switch_title if switch else None,
            "plannedStart": prompt.planned_start.isoformat(),
            "plannedEnd": prompt.planned_end.isoformat() if prompt.planned_end else None,
            "timezone": plan.timezone if plan else "UTC",
            "url": f"/schedule?prompt={prompt.id}",
        },
        ensure_ascii=False,
    )
    deliver(
        db,
        PlanPromptDelivery,
        prompt.id,
        prompt.revision,
        user.id,
        preferences,
        payload,
        origin=origin,
        settings=settings,
    )
    for other in others:
        deliver(
            db,
            PlanPromptDelivery,
            other.id,
            other.revision,
            user.id,
            preferences,
            "",
            origin=origin,
            settings=settings,
            silent=True,
        )
