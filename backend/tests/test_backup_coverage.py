import io
import json
import struct
import zipfile
from datetime import timedelta
from uuid import UUID

import pytest
from sqlalchemy import insert, select

from app.ai.assistant.models import AssistantChat, AssistantTurn
from app.ai.models import AiPrompt, AiRun
from app.auth.models import User
from app.backup import capacity
from app.core.errors import ContentTooLargeError
from app.core.security import utc_now
from app.habits.models import Habit
from app.notes.models import Message
from app.nutrition.models import Meal, MealPhoto
from app.time_tracking.models import TrackerState
from app.workspaces.models import Channel
from tests.conftest import API
from tests.test_backups import export, upload
from tests.test_habits import create
from tests.test_saved_food_photos import upload_photo


def test_backup_restores_preferences_pins_archives_and_chat_photos(owner, channel, db):
    user = db.scalar(select(User))
    user.appearance = {"accent": "#abcdef", "textSize": 17}
    user.watch_preferences = {"text_scale": 1.1}
    db.get(Channel, UUID(channel["id"])).pinned_at = utc_now()
    db.add(TrackerState(owner_id=user.id, start_minute=360, end_minute=1380, timezone="UTC"))
    db.add(
        AiPrompt(
            owner_id=user.id,
            name="Shorten",
            instructions="Keep it short",
            kind="rewrite",
            places=["messages"],
            sees="selection",
            model=None,
        )
    )
    db.commit()
    habit = create(owner)
    db.get(Habit, UUID(habit["id"])).archived = True
    photo = upload_photo(owner)
    original_photo = owner.get(f"{API}/nutrition/photos/{photo}").content
    chat = AssistantChat(owner_id=user.id, title="A picture")
    db.add(chat)
    db.flush()
    db.add(
        AssistantTurn(
            chat_id=chat.id,
            owner_id=user.id,
            role="user",
            content="Explain",
            photo_ids=[photo],
            attached={"channel_id": channel["id"]},
        )
    )
    db.commit()
    db.get(MealPhoto, UUID(photo)).created_at = utc_now() - timedelta(days=2)
    db.commit()
    upload_photo(owner, "cleanup-trigger.jpg")
    assert owner.get(f"{API}/nutrition/photos/{photo}").status_code == 200
    _, raw = export(owner)
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        content = json.loads(archive.read("content.json"))
    assert content["version"] == 16
    assert content["preferences"]["appearance"]["accent"] == "#abcdef"
    assert content["habits"][0]["archived"] is True
    assert content["assistant_photos"][0]["id"] == photo
    user.appearance = {"accent": "#123456"}
    db.commit()
    preview = upload(owner, raw)
    assert preview.status_code == 200, preview.text
    assert preview.json()["has_preferences"] is True
    restored = owner.post(
        f"{API}/backups/import",
        json={
            "token": preview.json()["token"],
            "mode": "replace",
            "confirmation": "REPLACE MY NOTES",
            "restore_preferences": True,
        },
    )
    assert restored.status_code == 200, restored.text
    db.expire_all()
    assert db.get(User, user.id).appearance["accent"] == "#abcdef"
    assert db.scalar(select(TrackerState)).start_minute == 360
    assert db.scalar(select(AiPrompt)).name == "Shorten"
    assert db.scalar(select(Habit)).archived is True
    restored_channel = db.scalar(select(Channel))
    assert restored_channel.pinned_at is not None
    turn = db.scalar(select(AssistantTurn))
    assert turn.attached["channel_id"] == str(restored_channel.id)
    assert turn.photo_ids[0] != photo
    assert owner.get(f"{API}/nutrition/photos/{turn.photo_ids[0]}").content == original_photo
    preview = upload(owner, raw).json()
    user.appearance = {"accent": "#123456"}
    db.commit()
    assert (
        owner.post(
            f"{API}/backups/import", json={"token": preview["token"], "restore_preferences": False}
        ).status_code
        == 200
    )
    db.expire_all()
    assert db.get(User, user.id).appearance["accent"] == "#123456"


def test_backup_accepts_zip64_and_rejects_a_bad_directory(owner, channel, monkeypatch):
    _, raw = export(owner)
    target = io.BytesIO()
    with monkeypatch.context() as context:
        context.setattr(zipfile, "ZIP64_LIMIT", 1)
        with (
            zipfile.ZipFile(io.BytesIO(raw)) as source,
            zipfile.ZipFile(target, "w", allowZip64=True) as archive,
        ):
            for entry in source.infolist():
                archive.writestr(entry.filename, source.read(entry))
    large = target.getvalue()
    assert b"PK\x06\x06" in large
    assert upload(owner, large).status_code == 200
    broken = bytearray(large)
    struct.pack_into("<Q", broken, len(broken) - 34, len(broken) + 100)
    assert upload(owner, bytes(broken)).status_code == 422


def test_backup_exceeds_previous_record_and_metadata_limits(owner, channel, db, monkeypatch):
    monkeypatch.setattr(capacity, "available_memory", lambda: 4 * 1024**3)
    user = db.scalar(select(User))
    db.execute(
        insert(Message),
        [
            {"channel_id": UUID(channel["id"]), "author_id": user.id, "content": "a" * 350}
            for _ in range(50_001)
        ],
    )
    db.commit()
    _, raw = export(owner)
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        metadata = archive.read("content.json")
    assert len(metadata) > 16 * 1024 * 1024
    assert len(json.loads(metadata)["messages"]) == 50_001
    assert upload(owner, raw).status_code == 200


def test_backup_capacity_checks_actual_resources(tmp_path, monkeypatch):
    monkeypatch.setattr(capacity, "available_memory", lambda: 1024)
    with pytest.raises(ContentTooLargeError):
        capacity.require_memory(1024)
    monkeypatch.setattr(
        capacity.shutil,
        "disk_usage",
        lambda _: capacity.shutil._ntuple_diskusage(10_000, 9_990, 10),
    )
    with pytest.raises(ContentTooLargeError):
        capacity.require_space(tmp_path, 100)


def test_writing_history_restores_conversations_without_restarting_requests(owner, channel, db):
    from uuid import uuid4

    user = db.scalar(select(User))
    conversation = uuid4()
    for outcome in ("success", "running"):
        db.add(
            AiRun(
                owner_id=user.id,
                conversation_id=conversation,
                prompt_name="Rewrite",
                instructions="Keep Markdown",
                kind="rewrite",
                place="messages",
                channel_id=UUID(channel["id"]),
                where="notes",
                model="test",
                input=[{"content": "Original"}],
                output="Rewritten",
                outcome=outcome,
            )
        )
    db.commit()
    _, raw = export(owner)
    preview = upload(owner, raw)
    assert preview.status_code == 200, preview.text
    result = owner.post(
        f"{API}/backups/import",
        json={
            "token": preview.json()["token"],
            "mode": "replace",
            "confirmation": "REPLACE MY NOTES",
        },
    )
    assert result.status_code == 200, result.text
    db.expire_all()
    runs = list(db.scalars(select(AiRun)))
    assert len(runs) == 2
    assert len({run.conversation_id for run in runs}) == 1
    assert runs[0].conversation_id != conversation
    assert all(run.channel_id == db.scalar(select(Channel.id)) for run in runs)
    assert {run.outcome for run in runs} == {"success", "failed"}
    assert next(run for run in runs if run.outcome == "failed").error


def test_replace_with_empty_content_clears_later_ai_history_and_meals(owner, channel, db):
    from tests.test_nutrition import meal, today

    _, raw = export(owner)
    user = db.scalar(select(User))
    db.add(
        AiRun(
            owner_id=user.id,
            prompt_name="Draft",
            instructions="Write",
            kind="draft",
            place="messages",
            channel_id=UUID(channel["id"]),
            where="notes",
            model="test",
            input=[],
            output="Later writing",
            outcome="success",
        )
    )
    db.commit()
    assert owner.post(f"{API}/nutrition/meals", json=meal(today(owner))).status_code == 201
    preview = upload(owner, raw).json()
    restored = owner.post(
        f"{API}/backups/import",
        json={"token": preview["token"], "mode": "replace", "confirmation": "REPLACE MY NOTES"},
    )
    assert restored.status_code == 200, restored.text
    db.expire_all()
    assert db.scalar(select(AiRun)) is None
    assert db.scalar(select(Meal)) is None
