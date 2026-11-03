from datetime import datetime
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from app.notifications.schemas import NotificationSettings
from app.time_tracking.models import TrackerState


def in_quiet_hours(
    db: Session, user_id: UUID, preferences: NotificationSettings, now: datetime
) -> bool:
    """Whether notifications wait right now. The window uses the account's calendar timezone
    and may cross midnight, such as 22:00 to 08:00."""
    if not preferences.quiet_hours:
        return False
    state = db.get(TrackerState, user_id)
    local = now.astimezone(ZoneInfo(state.timezone if state else "UTC"))
    minute = local.hour * 60 + local.minute
    start, end = preferences.quiet_start_minute, preferences.quiet_end_minute
    return start <= minute < end if start < end else minute >= start or minute < end
