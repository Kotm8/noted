from collections.abc import Awaitable, Callable
from typing import Any
from uuid import UUID, uuid4, uuid5

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.backup.schemas import (
    BackupContent,
    BackupFinance,
    BackupFinanceAccount,
    BackupFinanceEntry,
    BackupFinanceItem,
)
from app.core.errors import ValidationError
from app.finance.models import (
    FinanceAccount,
    FinanceAsset,
    FinanceEntry,
    FinanceItem,
    FinanceMutation,
    FinanceProfile,
)
from app.finance.schemas import SCHEMAS, ImportState, ProfileFields

MODELS = (FinanceProfile, FinanceAccount, FinanceEntry, FinanceItem, FinanceAsset)


def finance_queries(owner: UUID) -> dict[str, Any]:
    return {
        model.__tablename__: select(model.__table__).where(model.owner_id == owner)
        for model in MODELS
    }


async def finance_document(
    rows: dict[str, list[dict[str, Any]]], add_file: Callable[[str, int], Awaitable[dict[str, Any]]]
) -> dict[str, Any] | None:
    if not rows["finance_profiles"]:
        return None
    profile = rows["finance_profiles"][0]
    assets = []
    for row in rows["finance_assets"]:
        assets.append(
            {
                "id": row["id"],
                "filename": row["filename"],
                "content_type": row["content_type"],
                "created_at": row["created_at"],
                "file": await add_file(row["storage_key"], row["size"]),
            }
        )

    def fields(row: dict[str, Any], schema: Any) -> dict[str, Any]:
        return {key: row[key] for key in schema.model_fields if key in row}

    return {
        "finance": {
            "settings": fields(profile, ProfileFields),
            "settings_revision": profile["revision"],
            "accounts": [fields(row, BackupFinanceAccount) for row in rows["finance_accounts"]],
            "entries": [fields(row, BackupFinanceEntry) for row in rows["finance_entries"]],
            "items": [fields(row, BackupFinanceItem) for row in rows["finance_items"]],
            "assets": assets,
        }
    }


def validate_finance(data: BackupContent) -> None:
    finance = data.finance
    if finance is None:
        return
    if data.version < 14:
        raise ValidationError("Finance requires backup format 14")
    all_ids = [
        item.id
        for group in (finance.accounts, finance.entries, finance.items, finance.assets)
        for item in group
    ]
    if len(all_ids) != len(set(all_ids)):
        raise ValidationError("Duplicate Finance record IDs")
    accounts = {str(item.id) for item in finance.accounts}
    assets = {str(item.id) for item in finance.assets}
    entries = {str(item.id) for item in finance.entries}
    items = {str(item.id): item.kind for item in finance.items}
    if (
        finance.settings.default_account_id
        and str(finance.settings.default_account_id) not in accounts
    ):
        raise ValidationError("The default Finance account is missing")
    for entry in finance.entries:
        if str(entry.account_id) not in accounts or (
            entry.target_account_id and str(entry.target_account_id) not in accounts
        ):
            raise ValidationError("A Finance transaction references an unknown account")
        if any(str(identifier) not in assets for identifier in entry.photo_ids):
            raise ValidationError("A Finance source image is missing")
        if entry.import_id and items.get(str(entry.import_id)) != "import":
            raise ValidationError("Unknown Finance import")
        if entry.occurrence_id and items.get(str(entry.occurrence_id)) != "occurrence":
            raise ValidationError("Unknown payment occurrence")
    for item in finance.items:
        fields = item.fields
        if item.kind == "import":
            ImportState.model_validate(fields)
        if item.kind in SCHEMAS:
            SCHEMAS[item.kind].model_validate(
                {
                    key: value
                    for key, value in fields.items()
                    if key in SCHEMAS[item.kind].model_fields
                }
            )
        for name in ("account_id", "target_account_id"):
            if fields.get(name) and fields[name] not in accounts:
                raise ValidationError("Unknown Finance account reference")
        if any(str(identifier) not in assets for identifier in fields.get("photo_ids", [])):
            raise ValidationError("Unknown Finance image reference")
        if fields.get("purchase_id") and items.get(fields["purchase_id"]) != "purchase":
            raise ValidationError("Unknown purchase reservation")
        if fields.get("payment_id") and items.get(fields["payment_id"]) != "payment":
            raise ValidationError("Unknown recurring payment")
        if fields.get("entry_id") and fields["entry_id"] not in entries:
            raise ValidationError("Unknown Finance expense link")
        if item.kind == "import":
            if fields.get("status") not in {"imported", "undone"}:
                raise ValidationError("Invalid Finance import status")
            for entry in fields.get("entries", []):
                if entry.get("id") not in entries:
                    raise ValidationError("Unknown imported transaction")
                if not isinstance(entry.get("revision"), int) or entry["revision"] < 1:
                    raise ValidationError("Invalid imported transaction revision")
            pending = fields.get("pending", [])
            if not isinstance(pending, list) or len(pending) > 200:
                raise ValidationError("Invalid pending import rows")
            indices = set()
            for row in pending:
                if not isinstance(row.get("index"), int) or row["index"] in indices:
                    raise ValidationError("Invalid pending import row index")
                indices.add(row["index"])
                if row.get("status") not in {"pending", "recorded", "skipped"}:
                    raise ValidationError("Invalid pending import row status")
                if str(row.get("fields", {}).get("account_id")) not in accounts:
                    raise ValidationError("Unknown pending import account")
                if any(
                    items.get(str(identifier)) != "occurrence"
                    for identifier in row.get("occurrence_ids", [])
                ):
                    raise ValidationError("Unknown pending import payment match")
            for previous in fields.get("previous_links", []):
                if items.get(previous.get("id")) != "occurrence":
                    raise ValidationError("Unknown reconciled payment snapshot")
                if not isinstance(previous.get("revision"), int) or previous["revision"] < 1:
                    raise ValidationError("Invalid reconciled payment revision")
                SCHEMAS["occurrence"].model_validate(previous.get("fields", {}))
                if previous["fields"]["account_id"] not in accounts:
                    raise ValidationError("Unknown reconciled payment account")
        if item.kind == "payment" and "next_index" in fields:
            if not isinstance(fields["next_index"], int) or not 0 <= fields["next_index"] <= 100000:
                raise ValidationError("Invalid recurring payment cursor")
        if item.kind == "payment" and fields.get("effective_from"):
            from datetime import date

            date.fromisoformat(fields["effective_from"])


def check_currency(db: Session, owner: UUID, finance: BackupFinance | None, replace: bool) -> None:
    profile = db.get(FinanceProfile, owner)
    if finance and profile and not replace and finance.settings.currency != profile.currency:
        raise ValidationError(
            "Finance backups with a different currency cannot be merged. "
            "Use replace to restore their currency and records together."
        )


def restore_finance(
    db: Session, owner: UUID, data: BackupContent, keys: dict[str, str], replace: bool
) -> None:
    from app.finance.repository import FinanceRepository
    from app.live import mark

    finance = data.finance
    if not finance and not replace:
        return
    FinanceRepository(db).lock(owner)
    check_currency(db, owner, finance, replace)
    if replace:
        for model in (
            FinanceMutation,
            FinanceItem,
            FinanceEntry,
            FinanceAsset,
            FinanceProfile,
            FinanceAccount,
        ):
            db.execute(delete(model).where(model.owner_id == owner))
        db.flush()
    if finance is None:
        mark(db, "finance", user=owner)
        return
    identifiers = {
        str(item.id): str(uuid4())
        for group in (finance.accounts, finance.entries, finance.items, finance.assets)
        for item in group
    }
    for item in finance.items:
        if item.kind == "occurrence":
            identifiers[str(item.id)] = str(
                uuid5(UUID(identifiers[item.fields["payment_id"]]), item.fields["due_on"])
            )

    def remap(value: Any, key: str = "") -> Any:
        if isinstance(value, dict):
            return {name: remap(content, name) for name, content in value.items()}
        if isinstance(value, list):
            return [remap(content, key) for content in value]
        if isinstance(value, str) and (
            key == "id" or key.endswith("_id") or key in {"photo_ids", "occurrence_ids"}
        ):
            return identifiers.get(value, value)
        return value

    for account in finance.accounts:
        fields = account.model_dump(exclude={"id"})
        db.add(FinanceAccount(id=UUID(identifiers[str(account.id)]), owner_id=owner, **fields))
    db.flush()
    if db.get(FinanceProfile, owner) is None:
        fields = remap(finance.settings.model_dump(mode="json"))
        db.add(
            FinanceProfile(
                owner_id=owner,
                revision=finance.settings_revision,
                **{
                    **fields,
                    "default_account_id": UUID(fields["default_account_id"])
                    if fields.get("default_account_id")
                    else None,
                },
            )
        )
    for asset in finance.assets:
        db.add(
            FinanceAsset(
                id=UUID(identifiers[str(asset.id)]),
                owner_id=owner,
                storage_key=keys[asset.file.path],
                size=asset.file.size,
                filename=asset.filename,
                content_type=asset.content_type,
                created_at=asset.created_at,
            )
        )
    for item in finance.items:
        db.add(
            FinanceItem(
                id=UUID(identifiers[str(item.id)]),
                owner_id=owner,
                kind=item.kind,
                fields=remap(item.fields),
                deleted=item.deleted,
                revision=item.revision,
                created_at=item.created_at,
            )
        )
    for entry in finance.entries:
        fields = remap(entry.model_dump(mode="json", exclude={"id"}))
        for name in ("account_id", "target_account_id", "import_id", "occurrence_id"):
            fields[name] = UUID(fields[name]) if fields.get(name) else None
        fields["day"] = entry.day
        fields["payday_date"] = entry.payday_date
        fields["created_at"] = entry.created_at
        db.add(FinanceEntry(id=UUID(identifiers[str(entry.id)]), owner_id=owner, **fields))
    db.flush()
    from app.finance.imports import source_reference

    for item in finance.items:
        if item.kind != "import":
            continue
        for original in item.fields.get("entries", []):
            if original.get("reference"):
                restored_entry = db.get(FinanceEntry, UUID(identifiers[original["id"]]))
                if restored_entry is not None and not restored_entry.deleted:
                    source_reference(
                        db,
                        owner,
                        restored_entry.account_id,
                        restored_entry.day,
                        original["reference"],
                        restored_entry,
                    )
    mark(db, "finance", user=owner)
