import hashlib
import json
from datetime import datetime, time, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from app.ai.assistant.chats import remembered
from app.ai.calendar.models import CalendarApplicationRecord
from app.ai.calendar.schemas import (
    CalendarApplication,
    CalendarApplicationUpdate,
    CalendarApply,
    CalendarRequest,
    CalendarScope,
)
from app.ai.calendar.validation import overlaps, plan_fields, validate_blocks
from app.ai.context import check_budget
from app.ai.models import AiRun
from app.ai.prompts import preferences
from app.ai.runs import Prepared
from app.auth.models import User
from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.core.security import utc_now
from app.live import mark
from app.schedule.board import schedule_board
from app.schedule.recurrence import instants
from app.schedule.schemas import PlanResponse, ScheduleBoard
from app.schedule.service import ScheduleService
from app.time_tracking.repository import TrackingRepository


def context_board(db: Session, owner_id: UUID, scope: CalendarScope) -> ScheduleBoard:
    zone = ZoneInfo(scope.timezone)
    return schedule_board(
        db,
        owner_id,
        datetime.combine(scope.start, time(), zone),
        datetime.combine(scope.end + timedelta(days=1), time(), zone),
    )


def prepare_calendar(db: Session, owner_id: UUID, data: CalendarRequest) -> Prepared:
    user = db.get(User, owner_id)
    if user is None:
        raise NotFoundError("Account not found")
    settings = preferences(user)
    activities = [item for item in TrackingRepository(db).activities(owner_id) if not item.archived]
    if not activities:
        raise ValidationError("Add an activity in Time tracking settings first.")
    board = context_board(db, owner_id, data)
    scope = CalendarScope(**data.model_dump())
    payload = {
        "scope": scope.model_dump(mode="json"),
        "now": utc_now().isoformat(),
        "activities": [{"id": str(item.id), "name": item.name} for item in activities],
        "plans": [
            item.model_dump(mode="json", include={"title", "activity_id", "start_at", "end_at"})
            for item in board.plans
        ],
        "reminders": [
            {"due_at": item.due_at.isoformat(), "channel": item.channel_name}
            for item in board.reminders
        ],
        "current_proposals": [item.model_dump(mode="json") for item in data.proposals],
    }
    text = json.dumps(payload, ensure_ascii=False)
    turns = [turn.model_dump() for turn in data.history]
    instructions = data.instructions.strip()
    if not instructions:
        raise ValidationError("Write what you want to plan.")
    standing = settings.standing_note + remembered(db, owner_id, settings.memory)
    if settings.calendar_note.strip():
        standing += "\n\nCalendar preferences:\n" + settings.calendar_note.strip()
    check_budget(instructions, standing, [], text, [], turns)
    run_id = None
    if settings.keep_history:
        run = AiRun(
            owner_id=owner_id,
            prompt_name="Calendar planner",
            instructions=instructions,
            kind="answer",
            place="calendar",
            where=f"Calendar · {data.start} to {data.end}",
            model=settings.model,
            input=[{"text": text}],
        )
        db.add(run)
        db.commit()
        run_id = run.id
    return Prepared(
        owner_id=owner_id,
        timezone=scope.timezone,
        run_id=run_id,
        prompt_name="Calendar planner",
        instructions=instructions,
        kind="answer",
        model=settings.model,
        thinking=settings.thinking,
        web_search=False,
        standing_note=standing,
        numbered={},
        items=[],
        context=[],
        text=text,
        place="calendar",
        history=turns,
        calendar=scope,
        activity_ids=[item.id for item in activities],
    )


class CalendarService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.tracking = TrackingRepository(db)

    @staticmethod
    def response(record: CalendarApplicationRecord) -> CalendarApplication:
        return CalendarApplication(
            request_id=record.request_id,
            revision=record.revision,
            applied=record.applied,
            plans=[PlanResponse.model_validate(item) for item in record.plans],
        )

    def apply(self, owner_id: UUID, data: CalendarApply) -> CalendarApplication:
        self.tracking.lock(owner_id)
        fingerprint = hashlib.sha256(
            json.dumps(data.model_dump(mode="json"), sort_keys=True).encode()
        ).hexdigest()
        previous = self.db.get(CalendarApplicationRecord, data.request_id)
        if previous:
            if previous.owner_id != owner_id or previous.fingerprint != fingerprint:
                raise ConflictError("This request was already used for another calendar change.")
            return self.response(previous)
        active = [item.id for item in self.tracking.activities(owner_id) if not item.archived]
        validate_blocks(data.blocks, data, active)
        board = context_board(self.db, owner_id, data)
        occupied = [(item.start_at, item.end_at, item.title) for item in board.plans]
        schedule = ScheduleService(self.db)
        plans = []
        for block in data.blocks:
            fields = plan_fields(block, data)
            times = instants(fields, block.date)
            assert times is not None
            for start, end, title in occupied:
                if overlaps(times, (start, end)):
                    raise ConflictError(
                        f'"{block.title}" overlaps "{title}". Review the suggestions.'
                    )
            occupied.append((*times, block.title))
            plan = schedule.add(owner_id, fields)
            self.db.flush()
            plans.append(PlanResponse.model_validate(plan).model_dump(mode="json"))
        record = CalendarApplicationRecord(
            request_id=data.request_id,
            owner_id=owner_id,
            fingerprint=fingerprint,
            plans=plans,
            revision=1,
            applied=True,
        )
        self.db.add(record)
        self.db.commit()
        return self.response(record)

    def update(
        self, owner_id: UUID, request_id: UUID, data: CalendarApplicationUpdate
    ) -> CalendarApplication:
        self.tracking.lock(owner_id)
        record = self.db.get(CalendarApplicationRecord, request_id)
        if record is None or record.owner_id != owner_id:
            raise NotFoundError("Calendar addition not found")
        if record.revision != data.revision:
            raise ConflictError("This calendar addition changed. Refresh before trying again.")
        if record.applied == data.applied:
            return self.response(record)
        schedule = ScheduleService(self.db)
        changed = []
        for snapshot in record.plans:
            plan = schedule.checked(owner_id, UUID(snapshot["id"]), snapshot["revision"], True)
            if (plan.deleted_at is None) != record.applied:
                raise ConflictError("One of these plans changed. Your later changes were kept.")
            if data.applied:
                activity = self.tracking.activity(owner_id, plan.activity_id)
                if activity.archived:
                    raise ValidationError("Restore the activity before restoring these plans.")
                schedule.check_capacity(owner_id)
            plan.deleted_at = None if data.applied else utc_now()
            plan.revision += 1
            self.db.flush()
            changed.append(PlanResponse.model_validate(plan).model_dump(mode="json"))
        mark(self.db, "schedule", user=owner_id)
        record.plans, record.applied = changed, data.applied
        record.revision += 1
        self.db.commit()
        return self.response(record)
