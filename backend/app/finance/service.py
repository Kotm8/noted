import hashlib
import json
from datetime import date, timedelta
from typing import Any
from uuid import UUID, uuid5

from pydantic import ValidationError as SchemaError
from sqlalchemy import case, func, select
from sqlalchemy.inspection import inspect
from sqlalchemy.orm import Session

from app.core.errors import ConflictError, ValidationError
from app.finance.models import (
    FinanceAccount,
    FinanceEntry,
    FinanceItem,
    FinanceMutation,
)
from app.finance.repository import FinanceRepository
from app.finance.schemas import SCHEMAS, ExpenseResolution, FinanceAction


def record(row: Any) -> dict[str, Any]:
    return {
        column.key: getattr(row, column.key)
        for column in inspect(type(row)).columns
        if column.key != "owner_id"
    }


class FinanceService:
    def __init__(self, db: Session):
        self.db = db
        self.repository = FinanceRepository(db)

    def board(self, owner: UUID, month: date, search: str = "", offset: int = 0) -> dict[str, Any]:
        profile = self.repository.profile(owner)
        start = month.replace(day=1)
        end = (start.replace(day=28) + timedelta(days=4)).replace(day=1)
        criteria = [
            FinanceEntry.owner_id == owner,
            FinanceEntry.deleted.is_(False),
            FinanceEntry.day >= start,
            FinanceEntry.day < end,
        ]
        income, spent = self.db.execute(
            select(
                func.coalesce(
                    func.sum(case((FinanceEntry.kind == "income", FinanceEntry.amount), else_=0)), 0
                ),
                func.coalesce(
                    func.sum(case((FinanceEntry.kind == "expense", FinanceEntry.amount), else_=0)),
                    0,
                ),
            ).where(*criteria)
        ).one()
        income, spent = int(income), int(spent)
        if search:
            term = search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            criteria.append(
                FinanceEntry.name.ilike(f"%{term}%", escape="\\")
                | FinanceEntry.category.ilike(f"%{term}%", escape="\\")
            )
        entries = list(
            self.db.scalars(
                select(FinanceEntry)
                .where(*criteria)
                .order_by(FinanceEntry.day.desc(), FinanceEntry.created_at.desc(), FinanceEntry.id)
                .offset(offset)
                .limit(100)
            )
        )
        total = self.db.scalar(select(func.count()).select_from(FinanceEntry).where(*criteria)) or 0
        accounts = self.repository.balances(owner)
        settings = record(profile)
        return {
            "settings": settings,
            "accounts": accounts,
            "month": start.isoformat(),
            "income": income,
            "spent": spent,
            "profit": income - spent,
            "balance": sum(item["balance"] for item in accounts),
            "reserved": sum(item["reserved"] for item in accounts),
            "available": sum(item["available"] for item in accounts),
            "savings_goal": profile.savings_value
            if profile.savings_mode == "fixed"
            else income * profile.savings_value // 100,
            "entries": [record(item) for item in entries],
            "total_entries": total,
            "items": [record(item) for item in self.repository.board_items(owner)],
        }

    def execute(self, owner: UUID, action: FinanceAction) -> dict[str, Any]:
        self.repository.lock(owner)
        payload = action.model_dump(
            mode="json", exclude={"request_id", "title", "display_currency", "display_savings_mode"}
        )
        fingerprint = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
        previous = self.db.get(FinanceMutation, action.request_id)
        if previous:
            if previous.owner_id != owner or previous.fingerprint != fingerprint:
                raise ConflictError("This Finance request has already been used differently")
            return previous.result
        self.repository.profile(owner)
        if action.operation in {"confirm", "skip", "buy"}:
            result = self.resolve(owner, action)
        elif action.operation == "undo" and action.entity == "import":
            from app.finance.imports import undo_import

            result = undo_import(self, owner, action)
        else:
            result = self.change(owner, action)
        self.db.flush()
        if (action.entity == "reservation" and action.operation != "delete") or (
            action.entity == "purchase" and action.operation == "restore"
        ):
            for account in self.repository.balances(owner):
                if account["reserved"] and account["available"] < 0:
                    raise ValidationError(
                        f"There is not enough available money in {account['name']} "
                        "for this reservation."
                    )
        result = {**result, "request_id": str(action.request_id)}
        self.db.add(
            FinanceMutation(
                id=action.request_id, owner_id=owner, fingerprint=fingerprint, result=result
            )
        )
        self.db.flush()
        return result

    def change(self, owner: UUID, action: FinanceAction) -> dict[str, Any]:
        row: Any
        entity = action.entity
        if entity == "import" and action.operation == "update":
            from app.finance.imports import resolve_import

            return resolve_import(self, owner, action)
        if entity not in SCHEMAS:
            raise ValidationError("Use the spending import workflow for import batches")
        creating = action.operation == "create"
        if entity == "settings":
            if action.operation != "update":
                raise ValidationError("Finance settings can only be updated")
            row = self.repository.profile(owner)
        elif creating:
            if action.id is not None or action.revision is not None:
                raise ValidationError("New records must not include an existing ID or revision")
            row = None
        else:
            if action.id is None:
                raise ValidationError("Choose a Finance record")
            row = self.repository.get(owner, entity, action.id)
        if row is not None:
            self.repository.require_revision(row, action.revision)
        if action.operation in {"delete", "restore"}:
            if entity in {"settings", "account"}:
                raise ValidationError("Archive accounts in Finance settings")
            if entity in {"occurrence", "payment"}:
                raise ValidationError("Skip an occurrence or archive its recurring payment")
            if row.deleted == (action.operation == "delete"):
                raise ConflictError("This record has already changed")
            row.deleted = action.operation == "delete"
            row.revision += 1
            if entity == "purchase" and row.deleted:
                row.fields = {
                    **row.fields,
                    "released_reservations": self.release_purchase(owner, row.id),
                }
            elif entity == "purchase" and action.operation == "restore":
                for previous in row.fields.get("released_reservations", []):
                    reservation = self.repository.get(owner, "reservation", UUID(previous["id"]))
                    self.repository.require_revision(reservation, previous["revision"])
                    if not reservation.deleted:
                        raise ConflictError("A released reservation has changed")
                    reservation.deleted = False
                    reservation.revision += 1
                row.fields = {
                    key: value
                    for key, value in row.fields.items()
                    if key != "released_reservations"
                }
            if entity == "entry":
                self.sync_entry_links(owner, row)
            return {
                "entity": entity,
                "id": str(row.id),
                "revision": row.revision,
                "deleted": row.deleted,
            }
        if action.operation not in {"create", "update"}:
            raise ValidationError("This action is not supported for this record")
        if row is not None and getattr(row, "deleted", False):
            raise ConflictError("Restore this record before editing it")
        existing = (
            {} if row is None else row.fields if isinstance(row, FinanceItem) else record(row)
        )
        fields = {
            key: value for key, value in existing.items() if key in SCHEMAS[entity].model_fields
        }
        fields.update(action.fields)
        try:
            validated = SCHEMAS[entity].model_validate(fields)
        except SchemaError as error:
            raise ValidationError(error.errors()[0]["msg"]) from None
        data = validated.model_dump(mode="json")
        self.validate_links(owner, entity, data, row)
        if entity == "settings":
            if data["currency"] != row.currency and (
                self.db.scalar(
                    select(FinanceEntry.id).where(FinanceEntry.owner_id == owner).limit(1)
                )
                or self.db.scalar(
                    select(FinanceItem.id).where(FinanceItem.owner_id == owner).limit(1)
                )
                or any(item["opening_balance"] for item in self.repository.balances(owner))
            ):
                raise ValidationError(
                    "Currency cannot change after money has been recorded. "
                    "No amounts have been converted."
                )
        if row is None:
            identifier = uuid5(action.request_id, "finance-record")
            if entity == "account":
                row = FinanceAccount(id=identifier, owner_id=owner)
            elif entity == "entry":
                row = FinanceEntry(id=identifier, owner_id=owner)
            else:
                row = FinanceItem(id=identifier, owner_id=owner, kind=entity)
            self.db.add(row)
        else:
            row.revision += 1
        if isinstance(row, FinanceItem):
            if entity == "payment" and action.operation == "update":
                from app.finance.recurrence import today_for

                effective = today_for(self.db, owner).isoformat()
                for occurrence in self.repository.items(owner, "occurrence"):
                    if (
                        occurrence.fields["payment_id"] == str(row.id)
                        and occurrence.fields["status"] == "pending"
                        and occurrence.fields["due_on"] >= effective
                    ):
                        occurrence.deleted = True
                        occurrence.revision += 1
                data["effective_from"] = effective
            row.fields = data
        else:
            for name, value in validated.model_dump(mode="python").items():
                if name in {"categories", "paydays", "photo_ids"}:
                    value = data[name]
                setattr(row, name, value)
        self.db.flush()
        return {"entity": entity, "id": str(getattr(row, "id", owner)), "revision": row.revision}

    def validate_links(self, owner: UUID, entity: str, fields: dict[str, Any], row: Any) -> None:
        if entity == "settings" and not fields.get("default_account_id"):
            raise ValidationError("Choose a default Finance account")
        for key in ("account_id", "target_account_id", "default_account_id"):
            if fields.get(key):
                account = self.repository.get(owner, "account", UUID(fields[key]))
                if account.archived and (
                    row is None
                    or fields[key]
                    != (
                        row.fields.get(key)
                        if isinstance(row, FinanceItem)
                        else str(getattr(row, key, ""))
                    )
                ):
                    raise ValidationError("Choose an active account")
        for identifier in fields.get("photo_ids", []):
            from app.finance.assets import retain_assistant_photo

            retain_assistant_photo(self.db, owner, UUID(identifier))
        if entity == "account" and fields["archived"]:
            if self.repository.profile(owner).default_account_id == getattr(row, "id", None):
                raise ValidationError("Choose another default account before archiving this one")
            if row and any(
                item.fields.get("account_id") == str(row.id)
                for item in self.repository.items(owner, "reservation")
            ):
                raise ValidationError("Release this account's reservations before archiving it")
            if row and any(
                item.fields.get("account_id") == str(row.id) and not item.fields["archived"]
                for item in self.repository.items(owner, "payment")
            ):
                raise ValidationError("Archive or move this account's recurring payments first")
        if entity == "reservation" and fields.get("purchase_id"):
            purchase = self.repository.get(owner, "purchase", UUID(fields["purchase_id"]))
            if purchase.deleted or purchase.fields["status"] == "bought":
                raise ValidationError("Choose an active planned purchase")
            other = sum(
                item.fields["amount"]
                for item in self.repository.items(owner, "reservation")
                if item.id != getattr(row, "id", None)
                and item.fields.get("purchase_id") == fields["purchase_id"]
            )
            if other + fields["amount"] > purchase.fields["price"]:
                raise ValidationError("This would set aside more than the purchase price")
        if entity == "purchase":
            if fields["status"] == "bought" or fields.get("entry_id"):
                if (
                    row is None
                    or fields["status"] != row.fields["status"]
                    or fields.get("entry_id") != row.fields.get("entry_id")
                ):
                    raise ValidationError("Use Mark bought to link or record the expense")
        if entity == "occurrence":
            raise ValidationError("Occurrences are generated by their recurring payment")

    def release_purchase(self, owner: UUID, purchase_id: UUID) -> list[dict[str, Any]]:
        released = []
        for item in self.repository.items(owner, "reservation"):
            if item.fields.get("purchase_id") == str(purchase_id):
                item.deleted = True
                item.revision += 1
                released.append({"id": str(item.id), "revision": item.revision})
        return released

    def sync_entry_links(self, owner: UUID, entry: FinanceEntry) -> None:
        for item in self.repository.items(owner):
            if item.kind not in {"purchase", "occurrence"} or item.fields.get("entry_id") != str(
                entry.id
            ):
                continue
            item.fields = {
                **item.fields,
                "status": ("saving" if item.kind == "purchase" else "pending")
                if entry.deleted
                else ("bought" if item.kind == "purchase" else "paid"),
            }
            item.revision += 1

    def resolve(self, owner: UUID, action: FinanceAction) -> dict[str, Any]:
        expected = "purchase" if action.operation == "buy" else "occurrence"
        if action.entity != expected or action.id is None:
            raise ValidationError("Choose the purchase or payment occurrence to resolve")
        item = self.repository.get(owner, action.entity, action.id)
        self.repository.require_revision(item, action.revision)
        if item.deleted or item.fields["status"] in {"paid", "skipped", "bought"}:
            raise ConflictError("This item has already been resolved")
        try:
            resolution = ExpenseResolution.model_validate(action.fields)
        except SchemaError as error:
            raise ValidationError(error.errors()[0]["msg"]) from None
        values = resolution.model_dump(mode="json", exclude_none=True)
        if action.operation == "skip":
            item.fields = {**item.fields, "status": "skipped"}
        else:
            linked = values.get("entry_id")
            if linked:
                entry = self.repository.get(owner, "entry", UUID(str(linked)))
                if entry.deleted or entry.kind != "expense":
                    raise ValidationError("Choose a recorded expense")
                if item.kind == "occurrence" and entry.occurrence_id not in {None, item.id}:
                    raise ValidationError("That expense is already linked to another payment")
            else:
                from app.finance.recurrence import today_for

                data = {
                    "account_id": values.get("account_id")
                    or item.fields.get("account_id")
                    or str(self.repository.profile(owner).default_account_id),
                    "amount": values.get(
                        "amount", item.fields.get("amount", item.fields.get("price"))
                    ),
                    "day": values.get("day", today_for(self.db, owner).isoformat()),
                    "name": item.fields["name"],
                    "kind": "expense",
                    "category": item.fields.get("category", "Shopping"),
                    "photo_ids": item.fields.get("photo_ids", []),
                }
                result = self.change(
                    owner,
                    FinanceAction(
                        request_id=uuid5(action.request_id, "expense"),
                        entity="entry",
                        operation="create",
                        fields=data,
                    ),
                )
                entry = self.repository.get(owner, "entry", UUID(result["id"]))
            if item.kind == "purchase":
                self.release_purchase(owner, item.id)
            else:
                entry.occurrence_id = item.id
            entry.revision += 1
            item.fields = {
                **item.fields,
                "status": "bought" if item.kind == "purchase" else "paid",
                "entry_id": str(entry.id),
            }
        item.revision += 1
        return {
            "entity": item.kind,
            "id": str(item.id),
            "revision": item.revision,
            "entry_id": item.fields.get("entry_id"),
        }
