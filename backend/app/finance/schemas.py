from datetime import date
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

MAX_MONEY = 9_000_000_000_000
Money = int
Entity = Literal[
    "settings", "account", "entry", "purchase", "reservation", "payment", "occurrence", "import"
]


class Fields(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class Payday(Fields):
    name: str = Field(min_length=1, max_length=80)
    day: int = Field(ge=1, le=31)
    amount: int = Field(ge=0, le=MAX_MONEY, strict=True)
    delayed_until: date | None = None


class ProfileFields(Fields):
    currency: Literal["EUR", "USD", "GBP", "RUB"] = "EUR"
    gauge_maximum: int = Field(default=150000, gt=0, le=MAX_MONEY, strict=True)
    savings_mode: Literal["fixed", "percent"] = "fixed"
    savings_value: int = Field(default=0, ge=0, le=MAX_MONEY, strict=True)
    payment_reminder_days: int | None = Field(default=None, ge=0, le=30)
    reminder_minute: int = Field(default=540, ge=0, le=1439)
    categories: list[str] = Field(
        default_factory=lambda: [
            "Groceries",
            "Food & drink",
            "Transport",
            "Bills",
            "Shopping",
            "Income",
            "Other",
        ],
        max_length=100,
    )
    paydays: list[Payday] = Field(default_factory=list, max_length=12)
    default_account_id: UUID | None = None

    @field_validator("categories")
    @classmethod
    def category_names(cls, value: list[str]) -> list[str]:
        result = list(dict.fromkeys(name.strip() for name in value))
        if any(not name or len(name) > 80 for name in result):
            raise ValueError("Category names must contain 1 to 80 characters")
        return result

    @model_validator(mode="after")
    def percent(self) -> "ProfileFields":
        if self.savings_mode == "percent" and self.savings_value > 100:
            raise ValueError("Savings percentage must be between 0 and 100")
        return self


class AccountFields(Fields):
    name: str = Field(min_length=1, max_length=80)
    opening_balance: int = Field(default=0, ge=-MAX_MONEY, le=MAX_MONEY, strict=True)
    archived: bool = False


class EntryFields(Fields):
    account_id: UUID
    target_account_id: UUID | None = None
    kind: Literal["income", "expense", "transfer"]
    amount: int = Field(gt=0, le=MAX_MONEY, strict=True)
    day: date
    name: str = Field(min_length=1, max_length=200)
    category: str = Field(default="Other", min_length=1, max_length=80)
    notes: str = Field(default="", max_length=8000)
    photo_ids: list[UUID] = Field(default_factory=list, max_length=8)
    payday_date: date | None = None

    @model_validator(mode="after")
    def transfer(self) -> "EntryFields":
        if self.kind == "transfer":
            if not self.target_account_id or self.target_account_id == self.account_id:
                raise ValueError("Choose two different accounts for a transfer")
        elif self.target_account_id is not None:
            raise ValueError("Only transfers have a destination account")
        if self.payday_date and self.kind != "income":
            raise ValueError("Only income can be linked to a payday")
        return self


class PurchaseFields(Fields):
    name: str = Field(min_length=1, max_length=200)
    price: int = Field(gt=0, le=MAX_MONEY, strict=True)
    priority: Literal["Low", "Medium", "High"] = "Medium"
    target_date: date | None = None
    notes: str = Field(default="", max_length=8000)
    link: str = Field(default="", max_length=2000)
    photo_ids: list[UUID] = Field(default_factory=list, max_length=8)
    status: Literal["considering", "saving", "bought"] = "considering"
    entry_id: UUID | None = None

    @field_validator("link")
    @classmethod
    def safe_link(cls, value: str) -> str:
        if value and not value.lower().startswith(("https://", "http://")):
            raise ValueError("Use an http or https product link")
        return value


class ReservationFields(Fields):
    account_id: UUID
    purchase_id: UUID | None = None
    amount: int = Field(gt=0, le=MAX_MONEY, strict=True)
    day: date


class PaymentFields(Fields):
    reminder_days: int | None = Field(default=None, ge=-1, le=30)
    name: str = Field(min_length=1, max_length=200)
    account_id: UUID
    amount: int = Field(gt=0, le=MAX_MONEY, strict=True)
    category: str = Field(default="Bills", min_length=1, max_length=80)
    starts_on: date
    unit: Literal["day", "week", "month", "year"] = "month"
    interval: int = Field(default=1, ge=1, le=365)
    confirm: bool = True
    archived: bool = False


class OccurrenceFields(Fields):
    confirm: bool = True
    payment_id: UUID
    due_on: date
    name: str = Field(min_length=1, max_length=200)
    account_id: UUID
    amount: int = Field(gt=0, le=MAX_MONEY, strict=True)
    category: str = Field(default="Bills", min_length=1, max_length=80)
    status: Literal["pending", "paid", "skipped"] = "pending"
    entry_id: UUID | None = None


class FinanceChange(Fields):
    title: str = Field(default="", max_length=300)
    display_currency: str = Field(default="", max_length=3)
    display_savings_mode: Literal["fixed", "percent"] = "fixed"
    entity: Entity
    operation: Literal["create", "update", "delete", "restore", "buy", "confirm", "skip", "undo"]
    id: UUID | None = None
    revision: int | None = Field(default=None, ge=1)
    fields: dict[str, Any] = Field(default_factory=dict)


class ImportReference(Fields):
    id: UUID
    revision: int = Field(ge=1)
    reference: str | None = Field(default=None, max_length=200)


class PendingImportRow(Fields):
    reference: str | None = Field(default=None, max_length=200)
    index: int = Field(ge=0, le=199)
    fields: dict[str, Any]
    reason: str = Field(max_length=1000)
    occurrence_ids: list[UUID] = Field(default_factory=list, max_length=200)
    status: Literal["pending", "recorded", "skipped"] = "pending"


class ReconciledPayment(ImportReference):
    fields: OccurrenceFields


class ImportState(Fields):
    photo_ids: list[UUID] = Field(max_length=8)
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    account_id: UUID
    entries: list[ImportReference] = Field(max_length=200)
    pending: list[PendingImportRow] = Field(max_length=200)
    skipped: int = Field(ge=0, le=200)
    note: str = Field(default="", max_length=2000)
    status: Literal["imported", "undone"]
    previous_links: list[ReconciledPayment] = Field(default_factory=list, max_length=200)


class ExpenseResolution(Fields):
    day: date | None = None
    amount: int | None = Field(default=None, gt=0, le=MAX_MONEY, strict=True)
    account_id: UUID | None = None
    entry_id: UUID | None = None


class ImportResolution(Fields):
    index: int = Field(ge=0, le=199, strict=True)
    skip: bool = False
    entry: EntryFields | None = None
    occurrence_id: UUID | None = None

    @model_validator(mode="after")
    def entry_required(self) -> "ImportResolution":
        if not self.skip and self.entry is None:
            raise ValueError("Review the entry before recording it")
        return self


class FinanceAction(FinanceChange):
    request_id: UUID


SCHEMAS: dict[str, type[Fields]] = {
    "settings": ProfileFields,
    "account": AccountFields,
    "entry": EntryFields,
    "purchase": PurchaseFields,
    "reservation": ReservationFields,
    "payment": PaymentFields,
    "occurrence": OccurrenceFields,
}
