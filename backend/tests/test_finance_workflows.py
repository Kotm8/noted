import asyncio
import io
import zipfile
from datetime import date
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.models import User
from app.backup.services.archive import blobs, validate_graph
from app.backup.services.exporter import BackupExporter
from app.backup.services.importer import BackupImporter
from app.finance.imports import ExtractedRow, Extraction
from app.finance.service import FinanceService
from tests.test_finance import API, change


def image() -> bytes:
    content = io.BytesIO()
    Image.new("RGB", (80, 80), "white").save(content, format="PNG")
    return content.getvalue()


def test_spending_import_retry_pending_rows_and_undo(
    owner: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.finance import imports

    account = owner.get(API).json()["accounts"][0]["id"]
    change(
        owner,
        "entry",
        {
            "name": "Initial income",
            "kind": "income",
            "account_id": account,
            "amount": 10000,
            "day": "2026-11-16",
        },
    )
    calls = []

    async def extract(*args: object) -> Extraction:
        calls.append(1)
        return Extraction(
            rows=[
                ExtractedRow(name="Groceries", kind="expense", amount=1200, day=date(2026, 11, 16)),
                ExtractedRow(
                    name="Unclear", kind="expense", amount=None, uncertainty="Amount cut off"
                ),
            ]
        )

    monkeypatch.setattr(imports, "extract_picture", extract)
    photo = owner.post(f"{API}/photos", files={"file": ("spending.png", image(), "image/png")})
    assert photo.status_code == 201, photo.text
    body = {
        "request_id": str(uuid4()),
        "photo_id": photo.json()["id"],
        "account_id": account,
        "day": "2026-11-16",
    }
    response = owner.post(f"{API}/imports", json=body)
    assert response.status_code == 200, response.text
    batch = response.json()
    assert len(batch["entries"]) == 1 and len(batch["pending"]) == 1
    assert (
        owner.post(f"{API}/imports", json={**body, "request_id": str(uuid4())}).json()["id"]
        == batch["id"]
    )
    assert len(calls) == 1
    board = owner.get(API, params={"month": "2026-11-01"}).json()
    assert board["spent"] == 1200
    change(owner, "import", {}, operation="undo", id=batch["id"], revision=batch["revision"])
    board = owner.get(API, params={"month": "2026-11-01"}).json()
    assert board["spent"] == 0 and board["income"] == 10000
    assert owner.get(f"{API}/photos/{photo.json()['id']}").status_code == 200


def test_recurring_processing_edit_and_archive(owner: TestClient) -> None:
    board = owner.get(API).json()
    account = board["accounts"][0]["id"]
    day = board["today"]
    payment = change(
        owner,
        "payment",
        {
            "name": "Internet",
            "account_id": account,
            "amount": 4800,
            "starts_on": day,
            "confirm": False,
        },
    )
    before = owner.get(API).json()
    assert before["spent"] == 4800
    rule = next(item for item in before["items"] if item["id"] == payment["id"])
    change(
        owner,
        "payment",
        {"amount": 5000},
        operation="update",
        id=rule["id"],
        revision=rule["revision"],
    )
    after = owner.get(API).json()
    assert after["spent"] == 4800
    future = [
        item
        for item in after["items"]
        if item["kind"] == "occurrence" and item["fields"]["status"] == "pending"
    ]
    assert future and all(item["fields"]["amount"] == 5000 for item in future)
    from datetime import timedelta

    rule = next(item for item in after["items"] if item["id"] == payment["id"])
    change(
        owner,
        "payment",
        {"unit": "day", "starts_on": (date.fromisoformat(day) - timedelta(days=3)).isoformat()},
        operation="update",
        id=rule["id"],
        revision=rule["revision"],
    )
    after = owner.get(API).json()
    assert after["spent"] == 4800
    rule = next(item for item in after["items"] if item["id"] == payment["id"])
    change(
        owner,
        "payment",
        {"archived": True},
        operation="update",
        id=rule["id"],
        revision=rule["revision"],
    )
    final = owner.get(API).json()
    assert final["spent"] == 4800
    assert not [
        item
        for item in final["items"]
        if item["kind"] == "occurrence" and item["fields"]["status"] == "pending"
    ]


def test_backup_restores_money_images_and_references(
    owner: TestClient, db: Session, app: FastAPI, tmp_path: Path
) -> None:
    account = owner.get(API).json()["accounts"][0]["id"]
    change(
        owner,
        "entry",
        {
            "name": "Income",
            "kind": "income",
            "account_id": account,
            "amount": 90000,
            "day": "2026-11-16",
        },
    )
    photo = owner.post(
        f"{API}/photos", files={"file": ("purchase.png", image(), "image/png")}
    ).json()["id"]
    purchase = change(owner, "purchase", {"name": "Keyboard", "price": 15000, "photo_ids": [photo]})
    change(
        owner,
        "reservation",
        {"account_id": account, "purchase_id": purchase["id"], "amount": 5000, "day": "2026-11-16"},
    )
    user = db.scalar(select(User))
    assert user is not None
    path = tmp_path / "finance.zip"
    data = asyncio.run(BackupExporter(db, app.state.storage).create(user.id, path))
    assert data.version == 14 and data.finance and len(data.finance.assets) == 1
    validate_graph(data)
    staging = tmp_path / "staged"
    staging.mkdir()
    with zipfile.ZipFile(path) as archive:
        for blob, _ in blobs(data):
            (staging / blob.path.split("/")[1]).write_bytes(archive.read(blob.path))
    asyncio.run(BackupImporter(db, app.state.storage).restore(data, staging, user.id, replace=True))
    board = FinanceService(db).board(user.id, date(2026, 11, 1))
    assert (board["balance"], board["reserved"], board["profit"]) == (90000, 5000, 90000)
    restored = next(item for item in board["items"] if item["kind"] == "purchase")
    assert restored["id"] != UUID(purchase["id"])
    assert owner.get(f"{API}/photos/{restored['fields']['photo_ids'][0]}").status_code == 200


def test_shared_assistant_finance_actions_are_reviewed_and_idempotent(owner: TestClient) -> None:
    account = owner.get(API).json()["accounts"][0]["id"]
    body = {
        "request_id": str(uuid4()),
        "start": "2026-11-16",
        "end": "2026-11-16",
        "timezone": "UTC",
        "start_minute": 0,
        "end_minute": 1440,
        "explanation": "Record income",
        "habits": [],
        "plans": [],
        "meals": [],
        "finance": [
            {
                "entity": "entry",
                "operation": "create",
                "fields": {
                    "account_id": account,
                    "name": "Freelance",
                    "kind": "income",
                    "amount": 40000,
                    "day": "2026-11-16",
                },
            }
        ],
    }
    first = owner.post("/api/v1/ai/assistant/apply", json=body)
    assert first.status_code == 200, first.text
    second = owner.post("/api/v1/ai/assistant/apply", json=body)
    assert second.json() == first.json()
    board = owner.get(API, params={"month": "2026-11-01"}).json()
    assert board["income"] == 40000
    entry = board["entries"][0]
    body.update(
        request_id=str(uuid4()),
        finance=[
            {
                "entity": "entry",
                "operation": "delete",
                "id": entry["id"],
                "revision": entry["revision"],
            }
        ],
    )
    assert owner.post("/api/v1/ai/assistant/apply", json=body).status_code == 422
    assert owner.get(API, params={"month": "2026-11-01"}).json()["income"] == 40000
    body["confirmed_finance"] = True
    assert owner.post("/api/v1/ai/assistant/apply", json=body).status_code == 200


def test_payment_notifications_clear_after_resolution(owner: TestClient, db: Session) -> None:
    from app.finance.models import FinanceItem
    from app.finance.notifications import notify_at

    board = owner.get(API).json()
    account = board["accounts"][0]["id"]
    change(
        owner,
        "payment",
        {"account_id": account, "name": "Mobile plan", "amount": 1900, "starts_on": board["today"]},
    )
    board = owner.get(API).json()
    occurrence = next(item for item in board["items"] if item["kind"] == "occurrence")
    row = db.get(FinanceItem, UUID(occurrence["id"]))
    assert row is not None and notify_at(db, row) is None
    change(
        owner,
        "settings",
        {"payment_reminder_days": 0, "reminder_minute": 540},
        operation="update",
        revision=board["settings"]["revision"],
    )
    db.expire_all()
    due = notify_at(db, row)
    assert due and due.hour == 9 and due.minute == 0
    token = f"finance:{row.id}:{row.revision}"
    assert (
        owner.get("/api/v1/notifications/reconcile", params={"items": token}).json()["stale"] == []
    )
    change(
        owner,
        "occurrence",
        {},
        operation="confirm",
        id=occurrence["id"],
        revision=occurrence["revision"],
    )
    assert owner.get("/api/v1/notifications/reconcile", params={"items": token}).json()[
        "stale"
    ] == [token]


def test_import_references_deduplicate_without_merging_two_real_purchases(
    owner: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.finance import imports

    board = owner.get(API).json()
    account = board["accounts"][0]["id"]
    row = ExtractedRow(
        name="Coffee",
        kind="expense",
        amount=400,
        day=date.fromisoformat(board["today"]),
        reference="BANK-123",
    )
    outputs = iter(
        [
            Extraction(rows=[row]),
            Extraction(rows=[row]),
            Extraction(
                rows=[
                    row.model_copy(update={"reference": None, "name": "Tea"}),
                    row.model_copy(update={"reference": None, "name": "Tea"}),
                ]
            ),
        ]
    )

    async def extract(*args: object) -> Extraction:
        return next(outputs)

    monkeypatch.setattr(imports, "extract_picture", extract)
    results = []
    for color in ("white", "blue", "green"):
        content = io.BytesIO()
        Image.new("RGB", (80, 80), color).save(content, format="PNG")
        photo = owner.post(
            f"{API}/photos", files={"file": ("source.png", content.getvalue(), "image/png")}
        ).json()["id"]
        response = owner.post(
            f"{API}/imports",
            json={
                "request_id": str(uuid4()),
                "photo_id": photo,
                "account_id": account,
                "day": board["today"],
            },
        )
        assert response.status_code == 200, response.text
        results.append(response.json())
    assert len(results[0]["entries"]) == 1
    assert results[1]["skipped"] == 1 and not results[1]["entries"]
    assert len(results[2]["entries"]) == 2 and not results[2]["pending"]
    assert owner.get(API).json()["spent"] == 1200
