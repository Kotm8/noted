import json
from datetime import datetime, time, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from app.auth.models import User
from app.core.config import Settings
from app.finance.models import FinanceDelivery, FinanceItem, FinanceProfile
from app.notifications.routing import deliver, dismiss_handled
from app.notifications.schemas import NotificationSettings
from app.time_tracking.models import TrackerState


def notify_at(db: Session, item: FinanceItem) -> datetime | None:
    rule = db.get(FinanceItem, UUID(item.fields["payment_id"]))
    profile = db.get(FinanceProfile, item.owner_id)
    if rule is None or profile is None or rule.fields["archived"] or not rule.fields["confirm"]:
        return None
    days = rule.fields.get("reminder_days")
    if days is None:
        days = profile.payment_reminder_days
    if days is None or days < 0:
        return None
    tracker = db.get(TrackerState, item.owner_id)
    zone = ZoneInfo(tracker.timezone if tracker else "UTC")
    due = datetime.fromisoformat(item.fields["due_on"]).date() - timedelta(days=days)
    return datetime.combine(
        due, time(profile.reminder_minute // 60, profile.reminder_minute % 60), zone
    )


def dispatch_finance(engine: Engine, settings: Settings, now: datetime) -> None:
    with Session(engine) as db:
        rows = list(
            db.scalars(
                select(FinanceItem)
                .where(
                    FinanceItem.kind == "occurrence",
                    FinanceItem.deleted.is_(False),
                    FinanceItem.fields["status"].astext == "pending",
                    FinanceItem.fields["due_on"].astext
                    >= (now.date() - timedelta(days=2)).isoformat(),
                    FinanceItem.fields["due_on"].astext
                    <= (now.date() + timedelta(days=31)).isoformat(),
                )
                .order_by(FinanceItem.created_at)
                .limit(500)
                .with_for_update(skip_locked=True)
            )
        )
        for item in rows:
            due = notify_at(db, item)
            if due is None or not due <= now < due + timedelta(days=1):
                continue
            user = db.get(User, item.owner_id)
            if user is None:
                continue
            preferences = NotificationSettings.model_validate(user.notification_preferences or {})
            if not preferences.enabled:
                continue
            profile = db.get(FinanceProfile, item.owner_id)
            if profile is None:
                continue
            amount = item.fields["amount"] / 100
            payload = json.dumps(
                {
                    "kind": "finance",
                    "messageId": str(item.id),
                    "revision": item.revision,
                    "title": f"Finance · {item.fields['name']}",
                    "body": f"{amount:,.2f} {profile.currency} · due {item.fields['due_on']}",
                    "url": f"/finance?payment={item.id}",
                },
                ensure_ascii=False,
            )
            deliver(
                db,
                FinanceDelivery,
                item.id,
                item.revision,
                item.owner_id,
                preferences,
                payload,
                origin=settings.app_origin,
                settings=settings,
                ttl=86400,
            )
        db.commit()
    with Session(engine) as db:
        dismiss_handled(
            db,
            FinanceDelivery,
            FinanceItem,
            "finance",
            origin=settings.app_origin,
            settings=settings,
        )
