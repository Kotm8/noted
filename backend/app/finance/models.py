import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import BigInteger, CheckConstraint, Date, DateTime, ForeignKey, Index, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.security import utc_now
from app.db.base import Base
from app.notifications.models import DeliveryProgress


class FinanceProfile(Base):
    __tablename__ = "finance_profiles"
    owner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    currency: Mapped[str] = mapped_column(String(3), default="EUR")
    gauge_maximum: Mapped[int] = mapped_column(BigInteger, default=150000)
    savings_mode: Mapped[str] = mapped_column(String(8), default="fixed")
    savings_value: Mapped[int] = mapped_column(BigInteger, default=0)
    payment_reminder_days: Mapped[int | None]
    reminder_minute: Mapped[int] = mapped_column(default=540)
    categories: Mapped[list[str]] = mapped_column(JSONB, default=list)
    paydays: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list)
    default_account_id: Mapped[uuid.UUID | None] = mapped_column()
    revision: Mapped[int] = mapped_column(default=1)


class FinanceAccount(Base):
    __tablename__ = "finance_accounts"
    __table_args__ = (Index("ix_finance_accounts_owner", "owner_id"),)
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(80))
    opening_balance: Mapped[int] = mapped_column(BigInteger, default=0)
    archived: Mapped[bool] = mapped_column(default=False)
    revision: Mapped[int] = mapped_column(default=1)


class FinanceEntry(Base):
    __tablename__ = "finance_entries"
    __table_args__ = (
        CheckConstraint("amount > 0", name="ck_finance_entry_amount"),
        CheckConstraint("kind IN ('income', 'expense', 'transfer')", name="ck_finance_entry_kind"),
        CheckConstraint(
            "(kind = 'transfer' AND target_account_id IS NOT NULL AND "
            "target_account_id <> account_id) OR "
            "(kind <> 'transfer' AND target_account_id IS NULL)",
            name="ck_finance_transfer_target",
        ),
        Index("ix_finance_entries_owner_day", "owner_id", "day"),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("finance_accounts.id"))
    target_account_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("finance_accounts.id"))
    kind: Mapped[str] = mapped_column(String(8))
    amount: Mapped[int] = mapped_column(BigInteger)
    day: Mapped[date] = mapped_column(Date)
    name: Mapped[str] = mapped_column(String(200))
    category: Mapped[str] = mapped_column(String(80), default="Other")
    notes: Mapped[str] = mapped_column(String(8000), default="")
    photo_ids: Mapped[list[str]] = mapped_column(JSONB, default=list)
    payday_date: Mapped[date | None] = mapped_column(Date)
    import_id: Mapped[uuid.UUID | None] = mapped_column()
    occurrence_id: Mapped[uuid.UUID | None] = mapped_column()
    deleted: Mapped[bool] = mapped_column(default=False)
    revision: Mapped[int] = mapped_column(default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class FinanceItem(Base):
    __tablename__ = "finance_items"
    __table_args__ = (
        CheckConstraint(
            "kind IN ('purchase', 'reservation', 'payment', 'occurrence', 'import')",
            name="ck_finance_item_kind",
        ),
        Index("ix_finance_items_owner_kind", "owner_id", "kind"),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(12))
    fields: Mapped[dict[str, Any]] = mapped_column(JSONB)
    deleted: Mapped[bool] = mapped_column(default=False)
    revision: Mapped[int] = mapped_column(default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class FinanceAsset(Base):
    __tablename__ = "finance_assets"
    __table_args__ = (Index("ix_finance_assets_owner", "owner_id"),)
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    storage_key: Mapped[str] = mapped_column(String(96))
    content_type: Mapped[str] = mapped_column(String(80))
    size: Mapped[int] = mapped_column(BigInteger)
    filename: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class FinanceMutation(Base):
    __tablename__ = "finance_mutations"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    fingerprint: Mapped[str] = mapped_column(String(64))
    result: Mapped[dict[str, Any]] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class FinanceDelivery(DeliveryProgress, Base):
    __tablename__ = "finance_deliveries"
    item_key = "occurrence_id"
    occurrence_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("finance_items.id", ondelete="CASCADE"), primary_key=True
    )
