from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from app.schedule.schemas import PlanCreate, PlanFields


def occurs_on(plan: PlanCreate, day: date) -> bool:
    if day < plan.date or (plan.repeat_until and day > plan.repeat_until):
        return False
    if plan.frequency == "none":
        return day == plan.date
    if plan.frequency == "daily":
        return True
    if plan.frequency == "monthly":
        return day.day == plan.date.day
    if day.weekday() not in plan.weekdays:
        return False
    first_week = plan.date - timedelta(days=plan.date.weekday())
    this_week = day - timedelta(days=day.weekday())
    return plan.frequency == "weekly" or ((this_week - first_week).days // 7) % 2 == 0


def instants(plan: PlanFields, day: date) -> tuple[datetime, datetime] | None:
    zone = ZoneInfo(plan.timezone)
    start = datetime.combine(day, time(), zone) + timedelta(minutes=plan.start_minute)
    end = datetime.combine(day, time(), zone) + timedelta(minutes=plan.end_minute)
    for moment in (start, end):
        if moment.astimezone(UTC).astimezone(zone).replace(tzinfo=None) != moment.replace(
            tzinfo=None
        ):
            return None
    return start.astimezone(UTC), end.astimezone(UTC)
