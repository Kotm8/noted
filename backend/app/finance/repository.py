from typing import Any
from uuid import UUID

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.auth.models import User
from app.core.errors import ConflictError, NotFoundError
from app.finance.models import (
    FinanceAccount,
    FinanceAsset,
    FinanceEntry,
    FinanceItem,
    FinanceProfile,
)
from app.finance.schemas import ProfileFields


class FinanceRepository:
    def __init__(self, db: Session):
        self.db = db

    def lock(self, owner: UUID) -> None:
        if self.db.scalar(select(User.id).where(User.id == owner).with_for_update()) is None:
            raise NotFoundError("Account not found")

    def profile(self, owner: UUID) -> FinanceProfile:
        row = self.db.get(FinanceProfile, owner)
        if row is None:
            self.lock(owner)
            row = self.db.get(FinanceProfile, owner)
            if row is None:
                account = FinanceAccount(owner_id=owner, name="Main", opening_balance=0)
                self.db.add(account)
                self.db.flush()
                row = FinanceProfile(
                    owner_id=owner,
                    **ProfileFields(default_account_id=account.id).model_dump(mode="python"),
                )
                self.db.add(row)
                self.db.flush()
        return row

    def get(self, owner: UUID, entity: str, identifier: UUID) -> Any:
        model: Any = (
            FinanceAccount
            if entity == "account"
            else FinanceEntry
            if entity == "entry"
            else FinanceAsset
            if entity == "asset"
            else FinanceItem
        )
        row = self.db.get(model, identifier)
        if (
            row is None
            or row.owner_id != owner
            or (isinstance(row, FinanceItem) and row.kind != entity)
        ):
            raise NotFoundError(f"Finance {entity} not found")
        return row

    def items(self, owner: UUID, kind: str | None = None) -> list[FinanceItem]:
        query = select(FinanceItem).where(
            FinanceItem.owner_id == owner, FinanceItem.deleted.is_(False)
        )
        if kind:
            query = query.where(FinanceItem.kind == kind)
        return list(self.db.scalars(query.order_by(FinanceItem.created_at, FinanceItem.id)))

    def balances(self, owner: UUID) -> list[dict[str, Any]]:
        source = {
            identifier: int(value)
            for identifier, value in self.db.execute(
                select(
                    FinanceEntry.account_id,
                    func.sum(
                        case(
                            (FinanceEntry.kind == "income", FinanceEntry.amount),
                            else_=-FinanceEntry.amount,
                        )
                    ),
                )
                .where(FinanceEntry.owner_id == owner, FinanceEntry.deleted.is_(False))
                .group_by(FinanceEntry.account_id)
            ).all()
        }
        incoming = {
            identifier: int(value)
            for identifier, value in self.db.execute(
                select(FinanceEntry.target_account_id, func.sum(FinanceEntry.amount))
                .where(
                    FinanceEntry.owner_id == owner,
                    FinanceEntry.deleted.is_(False),
                    FinanceEntry.kind == "transfer",
                )
                .group_by(FinanceEntry.target_account_id)
            ).all()
        }
        reserved: dict[str, int] = {}
        for item in self.items(owner, "reservation"):
            key = item.fields["account_id"]
            reserved[key] = reserved.get(key, 0) + item.fields["amount"]
        result = []
        for account in self.db.scalars(
            select(FinanceAccount)
            .where(FinanceAccount.owner_id == owner)
            .order_by(FinanceAccount.name)
        ):
            balance = int(
                account.opening_balance + source.get(account.id, 0) + incoming.get(account.id, 0)
            )
            held = reserved.get(str(account.id), 0)
            result.append(
                {
                    "id": str(account.id),
                    "name": account.name,
                    "opening_balance": account.opening_balance,
                    "archived": account.archived,
                    "revision": account.revision,
                    "balance": balance,
                    "reserved": held,
                    "available": balance - held,
                }
            )
        return result

    def board_items(self, owner: UUID) -> list[FinanceItem]:
        current = list(
            self.db.scalars(
                select(FinanceItem)
                .where(
                    FinanceItem.owner_id == owner,
                    FinanceItem.deleted.is_(False),
                    FinanceItem.kind != "import",
                    (FinanceItem.kind != "occurrence")
                    | (FinanceItem.fields["status"].astext == "pending"),
                )
                .order_by(FinanceItem.created_at, FinanceItem.id)
            )
        )
        imports = list(
            self.db.scalars(
                select(FinanceItem)
                .where(
                    FinanceItem.owner_id == owner,
                    FinanceItem.kind == "import",
                    FinanceItem.deleted.is_(False),
                )
                .order_by(FinanceItem.created_at.desc(), FinanceItem.id)
                .limit(10)
            )
        )
        return current + list(reversed(imports))

    def require_revision(self, row: Any, revision: int | None) -> None:
        if revision is None or row.revision != revision:
            raise ConflictError("This Finance record changed. Refresh it before saving.")
