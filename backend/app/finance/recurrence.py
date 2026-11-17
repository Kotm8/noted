import calendar
import logging
from datetime import date, timedelta
from uuid import UUID, uuid5
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from app.core.errors import ApplicationError
from app.core.security import utc_now
from app.finance.models import FinanceItem
from app.finance.repository import FinanceRepository
from app.finance.schemas import FinanceAction, OccurrenceFields, PaymentFields
from app.time_tracking.models import TrackerState


def today_for(db: Session, owner: UUID) -> date:
    tracker = db.get(TrackerState, owner)
    return utc_now().astimezone(ZoneInfo(tracker.timezone if tracker else "UTC")).date()


def occurrence_date(rule: PaymentFields, index: int) -> date:
    origin = rule.starts_on
    step = index * rule.interval
    if rule.unit in {"day", "week"}:
        return origin + timedelta(days=step * (7 if rule.unit == "week" else 1))
    months = origin.year * 12 + origin.month - 1 + step * (12 if rule.unit == "year" else 1)
    year, month = divmod(months, 12)
    return date(year, month + 1, min(origin.day, calendar.monthrange(year, month + 1)[1]))


def advance_owner(db: Session, owner: UUID) -> None:
    from app.finance.service import FinanceService

    repository = FinanceRepository(db)
    repository.lock(owner)
    today = today_for(db, owner)
    horizon = today + timedelta(days=45)
    remaining = 250
    for item in repository.items(owner, "payment"):
        rule = PaymentFields.model_validate(
            {key: value for key, value in item.fields.items() if key in PaymentFields.model_fields}
        )
        if rule.archived:
            continue
        index = int(item.fields.get("next_index", 0))
        while remaining and occurrence_date(rule, index) <= horizon:
            due = occurrence_date(rule, index)
            if due.isoformat() < item.fields.get("effective_from", "0001-01-01"):
                index += 1
                remaining -= 1
                continue
            identifier = uuid5(item.id, due.isoformat())
            existing = db.get(FinanceItem, identifier)
            if existing is None or (existing.deleted and existing.fields["status"] == "pending"):
                fields = OccurrenceFields(
                    payment_id=item.id,
                    due_on=due,
                    name=rule.name,
                    account_id=rule.account_id,
                    amount=rule.amount,
                    category=rule.category,
                    confirm=rule.confirm,
                )
                if existing is None:
                    db.add(
                        FinanceItem(
                            id=identifier,
                            owner_id=owner,
                            kind="occurrence",
                            fields=fields.model_dump(mode="json"),
                        )
                    )
                else:
                    existing.deleted = False
                    existing.fields = fields.model_dump(mode="json")
                    existing.revision += 1
                db.flush()
            index += 1
            remaining -= 1
        if index != item.fields.get("next_index"):
            item.fields = {**item.fields, "next_index": index}
        if not remaining:
            break
    for item in repository.items(owner, "occurrence"):
        if item.fields["status"] != "pending" or item.fields["due_on"] > today.isoformat():
            continue
        rule = repository.get(owner, "payment", UUID(item.fields["payment_id"]))
        if item.fields.get("confirm", rule.fields["confirm"]) or rule.fields["archived"]:
            continue
        FinanceService(db).execute(
            owner,
            FinanceAction(
                request_id=uuid5(item.id, "automatic-payment"),
                entity="occurrence",
                operation="confirm",
                id=item.id,
                revision=item.revision,
                fields={"day": item.fields["due_on"]},
            ),
        )


def advance_finance(engine: Engine) -> None:
    with Session(engine) as db:
        owners = list(
            db.scalars(
                select(FinanceItem.owner_id)
                .where(FinanceItem.kind == "payment", FinanceItem.deleted.is_(False))
                .distinct()
            )
        )
    for owner in owners:
        with Session(engine) as db:
            try:
                advance_owner(db, owner)
                db.commit()
            except ApplicationError:
                db.rollback()
                logging.getLogger(__name__).exception(
                    "Finance payments need attention for an owner"
                )
