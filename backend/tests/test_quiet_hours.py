import json
from datetime import timedelta
from unittest.mock import Mock
from uuid import uuid4

import pytest

from app.notifications import routing
from app.notifications.quiet import in_quiet_hours
from app.notifications.schemas import NotificationSettings
from app.schedule.prompts import delivery
from tests.conftest import API
from tests.test_plan_end_prompts import clock, ending  # noqa: F401
from tests.test_plan_prompts import NOW
from tests.test_reminders import subscribe


def quiet(owner, start, end, **values):
    settings = owner.get(f"{API}/notifications/settings").json()
    return owner.put(
        f"{API}/notifications/settings",
        json={
            **settings,
            "quiet_hours": True,
            "quiet_start_minute": start,
            "quiet_end_minute": end,
            **values,
        },
    )


@pytest.mark.parametrize(
    "start,end,hour,expected",
    [
        (1320, 480, 23, True),
        (1320, 480, 3, True),
        (1320, 480, 8, False),
        (1320, 480, 12, False),
        (780, 840, 13, True),
        (780, 840, 14, False),
    ],
)
def test_quiet_window_may_cross_midnight(db, start, end, hour, expected):
    preferences = NotificationSettings(
        quiet_hours=True, quiet_start_minute=start, quiet_end_minute=end
    )
    moment = NOW.replace(hour=hour)
    assert in_quiet_hours(db, uuid4(), preferences, moment) is expected


def test_notifications_wait_for_quiet_hours_to_end(owner, clock, db, monkeypatch):  # noqa: F811
    assert quiet(owner, 600, 600).status_code == 422
    assert quiet(owner, 690, 780).status_code == 200
    ending(owner, clock)
    subscribe(owner, "mobile")
    monkeypatch.setattr(routing, "utc_now", lambda: clock[0])
    send = Mock(return_value="accepted")
    monkeypatch.setattr(routing, "send_push", send)
    delivery.dispatch_plan_prompts(db.get_bind(), "https://notes.example.com", None)
    assert send.call_count == 0
    clock[0] = NOW.replace(hour=13) + timedelta(seconds=1)
    delivery.dispatch_plan_prompts(db.get_bind(), "https://notes.example.com", None)
    assert send.call_count == 1


def test_quiet_hours_are_off_by_default(owner):
    settings = owner.get(f"{API}/notifications/settings").json()
    assert settings["quiet_hours"] is False
    assert (settings["quiet_start_minute"], settings["quiet_end_minute"]) == (1320, 480)


def test_urgent_reminders_ring_during_quiet_hours(owner, channel, db, monkeypatch):
    from uuid import UUID

    from sqlalchemy import update

    from app.core.security import utc_now
    from app.notifications.worker import dispatch_due
    from app.reminders.models import Reminder
    from tests.test_reminders import create

    now = utc_now()
    minute = now.hour * 60 + now.minute
    assert quiet(owner, (minute - 60) % 1440, (minute + 60) % 1440).status_code == 200
    subscribe(owner, "mobile")
    calm = create(owner, channel)
    urgent = create(owner, channel, urgent=True)
    assert urgent["reminder"]["urgent"] is True and calm["reminder"]["urgent"] is False
    db.execute(
        update(Reminder)
        .where(Reminder.message_id.in_([UUID(calm["id"]), UUID(urgent["id"])]))
        .values(due_at=now - timedelta(seconds=1))
    )
    db.commit()
    send = Mock(return_value="accepted")
    monkeypatch.setattr(routing, "send_push", send)
    dispatch_due(db.get_bind(), "https://noted.example.com")
    assert [json.loads(call.args[3])["messageId"] for call in send.call_args_list] == [urgent["id"]]
