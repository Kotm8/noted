from datetime import date
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.errors import NotFoundError
from app.finance.recurrence import occurrence_date
from app.finance.repository import FinanceRepository
from app.finance.schemas import PaymentFields

API = "/api/v1/finance"


def change(owner: TestClient, entity: str, fields: dict, **extra: object) -> dict:
    response = owner.post(
        f"{API}/actions",
        json={
            "request_id": str(uuid4()),
            "entity": entity,
            "operation": "create",
            "fields": fields,
            **extra,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_ledger_transfers_reservations_and_retry(owner: TestClient) -> None:
    board = owner.get(API).json()
    account = board["accounts"][0]["id"]
    second = change(owner, "account", {"name": "Cash"})["id"]
    income = {
        "account_id": account,
        "kind": "income",
        "name": "Salary",
        "amount": 160000,
        "day": "2026-11-18",
        "payday_date": "2026-11-15",
    }
    request = {
        "request_id": str(uuid4()),
        "entity": "entry",
        "operation": "create",
        "fields": income,
    }
    first = owner.post(f"{API}/actions", json=request)
    assert first.status_code == 200, first.text
    assert owner.post(f"{API}/actions", json=request).json() == first.json()
    change(
        owner,
        "entry",
        {
            "account_id": account,
            "target_account_id": second,
            "kind": "transfer",
            "name": "ATM",
            "amount": 10000,
            "day": "2026-11-18",
        },
    )
    reserve = change(
        owner, "reservation", {"account_id": account, "amount": 20000, "day": "2026-11-18"}
    )
    change(
        owner,
        "entry",
        {
            "account_id": second,
            "kind": "expense",
            "name": "Food",
            "amount": 1000,
            "day": "2026-11-18",
        },
    )
    board = owner.get(API, params={"month": "2026-11-01"}).json()
    assert (
        board["income"],
        board["spent"],
        board["profit"],
        board["balance"],
        board["reserved"],
        board["available"],
    ) == (160000, 1000, 159000, 159000, 20000, 139000)
    assert (
        next(item for item in board["entries"] if item["name"] == "Salary")["day"] == "2026-11-18"
    )
    stale = owner.post(
        f"{API}/actions",
        json={
            "request_id": str(uuid4()),
            "entity": "reservation",
            "operation": "delete",
            "id": reserve["id"],
            "revision": 999,
        },
    )
    assert stale.status_code == 409
    changed_currency = owner.post(
        f"{API}/actions",
        json={
            "request_id": str(uuid4()),
            "entity": "settings",
            "operation": "update",
            "revision": board["settings"]["revision"],
            "fields": {"currency": "USD"},
        },
    )
    assert changed_currency.status_code == 422


def test_purchase_buy_links_existing_expense_and_releases_reserve(owner: TestClient) -> None:
    account = owner.get(API).json()["accounts"][0]["id"]
    change(
        owner,
        "entry",
        {
            "account_id": account,
            "kind": "income",
            "name": "Income",
            "amount": 50000,
            "day": "2026-11-18",
        },
    )
    purchase = change(owner, "purchase", {"name": "Headphones", "price": 10000})
    change(
        owner,
        "reservation",
        {"account_id": account, "purchase_id": purchase["id"], "amount": 6000, "day": "2026-11-18"},
    )
    expense = change(
        owner,
        "entry",
        {
            "account_id": account,
            "kind": "expense",
            "name": "Headphones",
            "amount": 10000,
            "day": "2026-11-18",
        },
    )
    change(
        owner,
        "purchase",
        {"entry_id": expense["id"]},
        operation="buy",
        id=purchase["id"],
        revision=purchase["revision"],
    )
    board = owner.get(API, params={"month": "2026-11-01"}).json()
    assert board["spent"] == 10000
    assert board["reserved"] == 0
    assert (
        next(item for item in board["items"] if item["id"] == purchase["id"])["fields"]["status"]
        == "bought"
    )


def test_monthly_recurrence_returns_to_original_day() -> None:
    rule = PaymentFields(name="Rent", account_id=uuid4(), amount=100, starts_on=date(2027, 1, 31))
    assert occurrence_date(rule, 1) == date(2027, 2, 28)
    assert occurrence_date(rule, 2) == date(2027, 3, 31)


def test_account_and_asset_ownership(owner: TestClient, db: Session) -> None:
    from uuid import UUID

    import pytest

    account = owner.get(API).json()["accounts"][0]["id"]
    with pytest.raises(NotFoundError):
        FinanceRepository(db).get(uuid4(), "account", UUID(account))
    response = owner.post(
        f"{API}/actions",
        json={
            "request_id": str(uuid4()),
            "entity": "entry",
            "operation": "create",
            "fields": {
                "account_id": str(uuid4()),
                "name": "Not mine",
                "amount": 100,
                "kind": "expense",
                "day": "2026-11-18",
            },
        },
    )
    assert response.status_code == 404
    assert owner.get(f"{API}/photos/{uuid4()}").status_code == 404


def test_purchase_delete_undo_restores_reservations(owner: TestClient) -> None:
    account = owner.get(API).json()["accounts"][0]["id"]
    change(
        owner,
        "entry",
        {
            "account_id": account,
            "kind": "income",
            "amount": 10000,
            "day": "2026-11-16",
            "name": "Income",
        },
    )
    purchase = change(owner, "purchase", {"name": "Book", "price": 3000})
    change(
        owner,
        "reservation",
        {"account_id": account, "purchase_id": purchase["id"], "amount": 2000, "day": "2026-11-16"},
    )
    deleted = change(
        owner, "purchase", {}, operation="delete", id=purchase["id"], revision=purchase["revision"]
    )
    assert owner.get(API).json()["reserved"] == 0
    change(
        owner, "purchase", {}, operation="restore", id=purchase["id"], revision=deleted["revision"]
    )
    assert owner.get(API).json()["reserved"] == 2000
