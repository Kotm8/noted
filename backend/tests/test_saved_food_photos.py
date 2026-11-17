from datetime import timedelta
from uuid import uuid4

from app.core.security import utc_now
from app.nutrition.models import MealPhoto
from tests.conftest import API
from tests.test_nutrition import OATS, meal, photo_bytes, today


def upload_photo(owner, name="food.jpg"):
    response = owner.post(
        f"{API}/nutrition/photos", files={"file": (name, photo_bytes(), "image/jpeg")}
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def test_ai_chat_photo_survives_original_meal_deletion(owner, db):
    from sqlalchemy import select

    from app.ai.assistant.models import AssistantChat, AssistantTurn
    from app.auth.models import User

    photo = upload_photo(owner)
    user = db.scalar(select(User))
    chat = AssistantChat(owner_id=user.id, title="Meal picture")
    db.add(chat)
    db.flush()
    db.add(
        AssistantTurn(
            chat_id=chat.id,
            owner_id=user.id,
            role="user",
            content="Keep this picture",
            photo_ids=[photo],
        )
    )
    db.commit()
    original = owner.post(
        f"{API}/nutrition/meals", json=meal(today(owner), photo_ids=[photo])
    ).json()
    assert owner.delete(f"{API}/nutrition/meals/{original['id']}?revision=1").status_code == 204
    assert owner.get(f"{API}/nutrition/photos/{photo}").status_code == 200


def test_saved_photo_survives_original_deletion_and_shared_file_cleanup(owner, db, app):
    photo = upload_photo(owner)
    day = today(owner)
    original = owner.post(f"{API}/nutrition/meals", json=meal(day, photo_ids=[photo])).json()
    saved = owner.post(
        f"{API}/nutrition/saved-meals",
        json={"name": "Breakfast", "items": [OATS], "photo_ids": [photo]},
    ).json()
    key = db.get(MealPhoto, photo).storage_key
    stored = app.state.settings.storage_path / key
    assert owner.delete(f"{API}/nutrition/meals/{original['id']}?revision=1").status_code == 204
    assert owner.get(f"{API}/nutrition/photos/{photo}").status_code == 200
    db.expire_all()
    db.get(MealPhoto, photo).created_at = utc_now() - timedelta(days=2)
    db.commit()
    upload_photo(owner, "cleanup.jpg")
    assert owner.get(f"{API}/nutrition/photos/{photo}").status_code == 200
    copies = []
    for _ in range(2):
        response = owner.post(
            f"{API}/nutrition/meals", json=meal(day, source="saved", saved_meal_id=saved["id"])
        )
        assert response.status_code == 201, response.text
        copies.append(response.json())
    db.expire_all()
    assert all(db.get(MealPhoto, item["photo_ids"][0]).storage_key == key for item in copies)
    assert owner.delete(f"{API}/nutrition/saved-meals/{saved['id']}?revision=1").status_code == 204
    db.expire_all()
    db.get(MealPhoto, photo).created_at = utc_now() - timedelta(days=2)
    db.commit()
    upload_photo(owner, "cleanup-again.jpg")
    assert stored.exists()
    for index, item in enumerate(copies):
        assert owner.get(f"{API}/nutrition/photos/{item['photo_ids'][0]}").status_code == 200
        assert owner.delete(f"{API}/nutrition/meals/{item['id']}?revision=1").status_code == 204
        assert stored.exists() is (index == 0)


def test_saved_photo_edits_keep_old_clients_compatible_and_reject_stale_changes(owner):
    first = upload_photo(owner)
    second = upload_photo(owner)
    saved = owner.post(
        f"{API}/nutrition/saved-meals", json={"name": "Oats", "items": [OATS], "photo_ids": [first]}
    ).json()
    path = f"{API}/nutrition/saved-meals/{saved['id']}"
    updated = owner.put(path, json={"name": "Porridge", "items": [OATS], "revision": 1})
    assert updated.json()["photo_ids"] == [first]
    swapped = owner.put(
        path, json={"name": "Porridge", "items": [OATS], "photo_ids": [second], "revision": 2}
    )
    assert swapped.status_code == 200 and swapped.json()["photo_ids"] == [second]
    assert (
        owner.put(
            path, json={"name": "Old", "items": [OATS], "photo_ids": [], "revision": 1}
        ).status_code
        == 409
    )
    assert owner.delete(f"{path}?revision=1").status_code == 409
    invalid = owner.post(
        f"{API}/nutrition/saved-meals",
        json={"name": "Missing", "items": [OATS], "photo_ids": [str(uuid4())]},
    )
    assert invalid.status_code == 404
    assert len(owner.get(f"{API}/nutrition").json()["saved_meals"]) == 1


def test_backup_restores_a_saved_photo_without_its_original_diary_meal(owner):
    from tests.test_backups import export, upload

    photo = upload_photo(owner)
    original = owner.post(
        f"{API}/nutrition/meals", json=meal(today(owner), photo_ids=[photo], remember=True)
    ).json()
    assert owner.delete(f"{API}/nutrition/meals/{original['id']}?revision=1").status_code == 204
    image = owner.get(f"{API}/nutrition/photos/{photo}").content
    _, raw = export(owner)
    preview = upload(owner, raw)
    assert preview.status_code == 200, preview.text
    assert preview.json()["counts"]["files"] == 1
    restored = owner.post(
        f"{API}/backups/import",
        json={
            "token": preview.json()["token"],
            "mode": "replace",
            "confirmation": "REPLACE MY NOTES",
        },
    )
    assert restored.status_code == 200, restored.text
    saved = owner.get(f"{API}/nutrition").json()["saved_meals"][0]
    assert saved["photo_ids"]
    assert owner.get(f"{API}/nutrition/photos/{saved['photo_ids'][0]}").content == image
