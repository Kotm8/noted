from datetime import UTC, datetime, timedelta
from typing import Protocol
from zoneinfo import ZoneInfo


class RecurringWriting(Protocol):
    @property
    def start_at(self) -> datetime: ...

    @property
    def timezone(self) -> str: ...

    @property
    def frequency(self) -> str: ...

    @property
    def weekdays(self) -> list[int]: ...


def next_occurrence(rule: RecurringWriting, after: datetime) -> datetime | None:
    zone = ZoneInfo(rule.timezone)
    start = rule.start_at.astimezone(zone)
    day = max(start.date(), after.astimezone(zone).date())
    anchor = start.date() - timedelta(days=start.weekday())
    for offset in range(3670):
        candidate = day + timedelta(days=offset)
        if rule.frequency == "monthly" and candidate.day != start.day:
            continue
        if rule.frequency in {"weekly", "biweekly"}:
            if candidate.weekday() not in rule.weekdays:
                continue
            if rule.frequency == "biweekly" and ((candidate - anchor).days // 7) % 2:
                continue
        local = datetime.combine(candidate, start.timetz().replace(tzinfo=None), zone)
        instant = local.astimezone(UTC)
        if instant.astimezone(zone).replace(tzinfo=None) != local.replace(tzinfo=None):
            continue
        if instant >= rule.start_at and instant > after:
            return instant
    return None
