import json
import math
from datetime import date, timedelta
from io import BytesIO

from PIL import Image
from pydantic_ai.models.function import DeltaToolCall, FunctionModel
from sqlalchemy import func, select

from app.ai.runs import RunService
from app.auth.models import User
from app.core.security import utc_now
from app.nutrition import energy
from app.nutrition.models import MealPhoto
from app.time_tracking.models import TimeSession
from tests.conftest import API
from tests.test_ai import AUTH

PROFILE = {
    "age": 27,
    "sex": "male",
    "height_cm": 181,
    "weight_kg": 82.4,
    "activity": "moderate",
    "goal": "Lose belly fat but keep my strength",
    "pace": "standard",
    "pregnant": False,
    "read_training": True,
}
OATS = {"name": "Rolled oats", "amount": "60 g", "kcal": 228, "protein": 8, "carbs": 40, "fat": 4}


def today(owner) -> str:
    return owner.get(f"{API}/nutrition").json()["today"]


def meal(day: str, **values):
    return {
        "day": day,
        "minute": 490,
        "slot": "Breakfast",
        "name": "Oats",
        "items": [OATS],
        **values,
    }


def events(response):
    assert response.status_code == 200, response.text
    return [json.loads(line) for line in response.text.splitlines()]


def stream(monkeypatch, chunks, captured=None):
    """A stand-in model that writes its typed answer in pieces, as ChatGPT does."""

    async def answer(messages, info):
        if captured is not None:
            captured.append(messages)
        for index, chunk in enumerate(chunks):
            yield {
                0: DeltaToolCall(
                    name=info.output_tools[0].name if index == 0 else None, json_args=chunk
                )
            }

    monkeypatch.setattr(RunService, "model", lambda *_: FunctionModel(stream_function=answer))


def photo_bytes(color="#d9a54e") -> bytes:
    output = BytesIO()
    Image.new("RGB", (1600, 1200), color).save(output, format="JPEG")
    return output.getvalue()


def test_energy_is_worked_out_by_the_server_with_safety_limits():
    assert energy.resting_energy("male", 82.4, 181, 27) == 1825
    assert energy.maintenance(1825, "moderate") == 2830
    middle = (
        energy.resting_energy("male", 70, 170, 30) + energy.resting_energy("female", 70, 170, 30)
    ) / 2
    assert abs(energy.resting_energy("unspecified", 70, 170, 30) - middle) <= 1
    usual = energy.limits("male", 82.4, 181, 27, "moderate", False)
    assert usual.lowest == max(1825, 1500, round(2830 * 0.75)) and usual.highest == round(
        2830 * 1.15
    )
    for case in (
        energy.limits("male", 70, 175, 16, "light", False),
        energy.limits("female", 65, 168, 30, "light", True),
        energy.limits("female", 45, 172, 30, "light", False),
    ):
        assert case.lowest == case.maintenance, case
    assert energy.current_age(27, date(2025, 11, 6), date(2026, 11, 5)) == 27
    assert energy.current_age(27, date(2025, 11, 5), date(2026, 11, 5)) == 28


def test_targets_stay_inside_limits_and_follow_their_start_day(owner):
    assert owner.get(f"{API}/nutrition").json()["profile"] is None
    assert (
        owner.put(
            f"{API}/nutrition/target", json={"kcal": 2000, "protein": 150, "carbs": 200, "fat": 70}
        ).status_code
        == 422
    )
    saved = owner.put(f"{API}/nutrition/profile", json=PROFILE)
    assert saved.status_code == 200, saved.text
    state = owner.get(f"{API}/nutrition").json()
    assert state["limits"]["maintenance"] == 2830 and state["limits"]["resting"] == 1825
    too_low = owner.put(
        f"{API}/nutrition/target", json={"kcal": 1700, "protein": 160, "carbs": 120, "fat": 60}
    )
    assert too_low.status_code == 422 and "2,122" in too_low.text
    mismatched = owner.put(
        f"{API}/nutrition/target", json={"kcal": 2260, "protein": 100, "carbs": 100, "fat": 40}
    )
    assert mismatched.status_code == 422 and "add up" in mismatched.text
    accepted = owner.put(
        f"{API}/nutrition/target",
        json={
            "kcal": 2260,
            "protein": 165,
            "carbs": 245,
            "fat": 70,
            "explanation": "Steady loss",
            "sources": [{"url": "https://example.org/protein", "title": "Protein"}],
        },
    )
    assert accepted.status_code == 200, accepted.text
    again = owner.put(
        f"{API}/nutrition/target", json={"kcal": 2300, "protein": 165, "carbs": 255, "fat": 70}
    )
    assert again.json()["id"] == accepted.json()["id"]
    state = owner.get(f"{API}/nutrition").json()
    assert state["target"]["kcal"] == 2300 and state["target"]["maintenance"] == 2830
    day = date.fromisoformat(state["today"])
    summary = owner.get(f"{API}/nutrition/days?start={day - timedelta(days=1)}&end={day}").json()
    assert [item["target"] for item in summary] == [None, 2300]


def test_meals_saved_meals_and_weigh_ins(owner):
    day = today(owner)
    created = owner.post(f"{API}/nutrition/meals", json=meal(day, remember=True, source="ai"))
    assert created.status_code == 201, created.text
    first = created.json()
    assert first["saved_meal_id"]
    saved = owner.get(f"{API}/nutrition").json()["saved_meals"]
    assert saved[0]["name"] == "Oats" and saved[0]["uses"] == 1
    again = owner.post(
        f"{API}/nutrition/meals",
        json=meal(day, minute=960, slot="Snack", source="saved", saved_meal_id=saved[0]["id"]),
    )
    assert again.status_code == 201
    assert owner.get(f"{API}/nutrition").json()["saved_meals"][0]["uses"] == 2
    duplicate = owner.post(f"{API}/nutrition/saved-meals", json={"name": "oats", "items": [OATS]})
    assert duplicate.status_code == 422
    edited = owner.put(
        f"{API}/nutrition/meals/{first['id']}",
        json={**meal(day, name="Big oats", items=[{**OATS, "kcal": 400}]), "revision": 1},
    )
    assert edited.status_code == 200 and edited.json()["revision"] == 2
    stale = owner.put(f"{API}/nutrition/meals/{first['id']}", json={**meal(day), "revision": 1})
    assert stale.status_code == 409
    summary = owner.get(f"{API}/nutrition/days?start={day}&end={day}").json()[0]
    assert summary["kcal"] == 400 + 228 and summary["meals"] == 2
    listed = owner.get(f"{API}/nutrition/meals?start={day}&end={day}").json()
    assert [item["slot"] for item in listed] == ["Breakfast", "Snack"]
    assert owner.delete(f"{API}/nutrition/meals/{first['id']}?revision=2").status_code == 204
    assert (
        owner.put(f"{API}/nutrition/weigh-ins", json={"day": day, "weight_kg": 82.1}).status_code
        == 200
    )
    assert (
        owner.put(f"{API}/nutrition/weigh-ins", json={"day": day, "weight_kg": 81.9}).status_code
        == 200
    )
    assert owner.get(f"{API}/nutrition").json()["weigh_ins"] == [{"day": day, "weight_kg": 81.9}]
    assert owner.delete(f"{API}/nutrition/weigh-ins/{day}").status_code == 204


def test_photos_are_kept_small_attached_once_and_removed_with_their_meal(owner, db, app):
    upload = owner.post(
        f"{API}/nutrition/photos", files={"file": ("lunch.jpg", photo_bytes(), "image/jpeg")}
    )
    assert upload.status_code == 201, upload.text
    photo_id = upload.json()["id"]
    served = owner.get(f"{API}/nutrition/photos/{photo_id}")
    assert served.headers["content-type"] == "image/webp"
    assert max(Image.open(BytesIO(served.content)).size) == 1280
    assert (
        owner.post(
            f"{API}/nutrition/photos", files={"file": ("notes.txt", b"hello", "text/plain")}
        ).status_code
        == 422
    )
    day = today(owner)
    created = owner.post(f"{API}/nutrition/meals", json=meal(day, photo_ids=[photo_id])).json()
    assert created["photo_ids"] == [photo_id]
    taken = owner.post(f"{API}/nutrition/meals", json=meal(day, photo_ids=[photo_id]))
    assert taken.status_code == 422
    photo = db.get(MealPhoto, created["photo_ids"][0])
    stored = app.state.settings.storage_path / photo.storage_key
    assert stored.exists()
    assert owner.delete(f"{API}/nutrition/meals/{created['id']}?revision=1").status_code == 204
    db.expire_all()
    assert db.scalar(select(func.count()).select_from(MealPhoto)) == 0
    assert not stored.exists()
    # A photo that never makes it into a meal goes after a day.
    old = owner.post(
        f"{API}/nutrition/photos", files={"file": ("old.jpg", photo_bytes("#507bbd"), "image/jpeg")}
    ).json()["id"]
    db.get(MealPhoto, old).created_at = utc_now() - timedelta(days=2)
    db.commit()
    owner.post(f"{API}/nutrition/photos", files={"file": ("new.jpg", photo_bytes(), "image/jpeg")})
    db.expire_all()
    assert db.get(MealPhoto, old) is None


def test_estimate_streams_items_and_checks_what_comes_back(owner, monkeypatch):
    blocked = owner.post(f"{API}/ai/nutrition/estimate", json={"text": "two eggs"})
    assert blocked.status_code == 422 and "Connect ChatGPT" in blocked.text
    owner.post(f"{API}/ai/connection", json={"auth_json": AUTH})
    owner.post(f"{API}/nutrition/saved-meals", json={"name": "Usual breakfast", "items": [OATS]})
    photo = owner.post(
        f"{API}/nutrition/photos", files={"file": ("dinner.jpg", photo_bytes(), "image/jpeg")}
    ).json()["id"]
    answer = json.dumps(
        {
            "name": "Salmon dinner",
            "items": [
                {"name": "Salmon fillet", "amount": "140 g", "kcal": 290, "protein": 31, "fat": 18},
                {
                    "name": "Roast potatoes",
                    "amount": "200 g",
                    "kcal": 260,
                    "carbs": 40,
                    "confidence": "medium",
                },
                {"name": "Side salad", "amount": "1 bowl", "kcal": 45, "confidence": "low"},
            ],
            "saved_meal": "Not a saved meal",
            "question": {
                "text": "How was the salad dressed?",
                "choices": [
                    {"label": "Olive oil", "item": 2, "kcal": 135, "fat": 11},
                    {"label": "None", "item": 2, "kcal": 45},
                    {"label": "Wrong item", "item": 9, "kcal": 1},
                ],
            },
        }
    )
    captured = []
    stream(monkeypatch, [answer[i : i + 40] for i in range(0, len(answer), 40)], captured)
    response = owner.post(
        f"{API}/ai/nutrition/estimate",
        json={"text": "salmon, potatoes, salad", "photo_ids": [photo]},
    )
    found = events(response)
    assert found[0]["type"] == "start" and found[1]["type"] == "thinking"
    snapshots = [item["items"] for item in found if item["type"] == "items"]
    assert [len(items) for items in snapshots] == [1, 2]
    done = found[-1]
    assert done["type"] == "done", found
    output = done["output"]
    assert [item["kcal"] for item in output["items"]] == [290, 260, 45]
    assert output["saved_meal"] is None
    assert [choice["label"] for choice in output["question"]["choices"]] == ["Olive oil", "None"]
    sent = str(captured)
    assert "Usual breakfast" in sent and "salmon, potatoes, salad" in sent
    assert "BinaryContent" in sent or "image/webp" in sent
    run = owner.get(f"{API}/ai/runs").json()[0]
    assert run["place"] == "nutrition" and run["outcome"] == "ready"
    assert owner.post(f"{API}/ai/nutrition/estimate", json={}).status_code == 422


def test_target_proposal_is_clamped_and_its_macros_add_up(owner, db, monkeypatch):
    owner.post(f"{API}/ai/connection", json={"auth_json": AUTH})
    activity = owner.post(
        f"{API}/time-tracking/activities",
        json={"name": "Gym"},
    ).json()
    owner_id = db.scalar(select(User.id))
    db.add(
        TimeSession(
            owner_id=owner_id,
            activity_id=activity["id"],
            started_at=utc_now() - timedelta(hours=3),
            ended_at=utc_now() - timedelta(hours=2),
        )
    )
    db.commit()
    captured = []
    stream(
        monkeypatch,
        [
            json.dumps(
                {
                    "kcal": 1500,
                    "protein": 400,
                    "carbs": 10,
                    "fat": 10,
                    "activity": "very",
                    "explanation": "You can't lose fat from one spot citeturn0search0.",
                }
            )
        ],
        captured,
    )
    found = events(owner.post(f"{API}/ai/nutrition/target", json={"profile": PROFILE}))
    output = found[-1]["output"]
    assert found[-1]["type"] == "done", found
    assert output["kcal"] == math.ceil(output["lowest"] / 10) * 10 and output["clamped"]
    assert output["protein"] == round(82.4 * 2.4 / 5) * 5
    assert output["fat"] >= 40
    made = output["protein"] * 4 + output["carbs"] * 4 + output["fat"] * 9
    assert abs(made - output["kcal"]) <= output["kcal"] * 0.15
    assert output["maintenance"] == 2830 and output["activity"] == "very"
    assert output["explanation"] == "You can't lose fat from one spot."
    assert "Gym" in str(captured) and "maintenance_kcal" in str(captured)
    assert owner.get(f"{API}/nutrition").json()["profile"]["weight_kg"] == 82.4
    accepted = owner.put(
        f"{API}/nutrition/target",
        json={key: output[key] for key in ("kcal", "protein", "carbs", "fat", "explanation")},
    )
    assert accepted.status_code == 200, accepted.text


def test_shared_assistant_sees_and_saves_meals(owner, monkeypatch):
    from uuid import uuid4

    owner.post(f"{API}/ai/connection", json={"auth_json": AUTH})
    owner.put(f"{API}/nutrition/profile", json=PROFILE)
    day = today(owner)
    logged = owner.post(f"{API}/nutrition/meals", json=meal(day)).json()
    captured = []

    async def answer(messages, info):
        captured.append(messages)
        yield {
            0: DeltaToolCall(
                name=info.output_tools[0].name,
                json_args=json.dumps(
                    {"explanation": "Logged", "habits": [], "plans": [], "meals": []}
                ),
            )
        }

    monkeypatch.setattr(RunService, "model", lambda *_: FunctionModel(stream_function=answer))
    scope = {"start": day, "end": day, "timezone": "UTC", "start_minute": 0, "end_minute": 1440}
    found = events(
        owner.post(
            f"{API}/ai/assistant", json={**scope, "instructions": "What did I eat?", "history": []}
        )
    )
    assert found[-1]["type"] == "done", found
    assert logged["id"] in str(captured) and "Rolled oats" in str(captured)
    fields = {"day": day, "minute": 780, "slot": "Lunch", "name": "Chicken bowl", "items": [OATS]}
    payload = {
        **scope,
        "explanation": "Lunch and a bigger breakfast",
        "habits": [],
        "plans": [],
        "meals": [
            {"id": None, "revision": None, "fields": fields, "picture": True},
            {
                "id": logged["id"],
                "revision": logged["revision"],
                "fields": {**fields, "minute": 490, "slot": "Breakfast", "name": "Big oats"},
            },
        ],
        "request_id": str(uuid4()),
    }
    result = owner.post(f"{API}/ai/assistant/apply", json=payload)
    assert result.status_code == 200, result.text
    assert len(result.json()["meals"]) == 2 and len(result.json()["pictures"]) == 1
    names = {
        item["name"] for item in owner.get(f"{API}/nutrition/meals?start={day}&end={day}").json()
    }
    assert names == {"Chicken bowl", "Big oats"}
    future = {**payload, "request_id": str(uuid4())}
    future["meals"] = [
        {"fields": {**fields, "day": (date.fromisoformat(day) + timedelta(days=5)).isoformat()}}
    ]
    assert owner.post(f"{API}/ai/assistant/apply", json=future).status_code == 422


def test_meal_pictures_are_generated_once_and_kept_as_photos(owner, monkeypatch):
    from pydantic_ai.messages import BinaryImage, FilePart, ModelResponse
    from pydantic_ai.native_tools import ImageGenerationTool
    from pydantic_ai.profiles import ModelProfile

    owner.post(f"{API}/ai/connection", json={"auth_json": AUTH})
    created = owner.post(f"{API}/nutrition/meals", json=meal(today(owner))).json()
    asked = []

    def draw(messages, info):
        asked.append(messages)
        return ModelResponse(
            parts=[FilePart(content=BinaryImage(data=photo_bytes(), media_type="image/jpeg"))]
        )

    monkeypatch.setattr(
        RunService,
        "model",
        lambda *_: FunctionModel(
            function=draw,
            profile=ModelProfile(
                supports_image_output=True, supported_native_tools=frozenset({ImageGenerationTool})
            ),
        ),
    )
    made = owner.post(f"{API}/ai/nutrition/meals/{created['id']}/picture")
    assert made.status_code == 201, made.text
    assert "Rolled oats" in str(asked)
    listed = owner.get(f"{API}/nutrition/meals?start={created['day']}&end={created['day']}").json()
    assert listed[0]["photo_ids"] == [made.json()["id"]]
    assert (
        owner.get(f"{API}/nutrition/photos/{made.json()['id']}").headers["content-type"]
        == "image/webp"
    )
    again = owner.post(f"{API}/ai/nutrition/meals/{created['id']}/picture")
    assert again.status_code == 422 and "already has a photo" in again.text


def test_backups_keep_nutrition_and_meal_photos(owner, db):
    from tests.test_backups import export, upload

    owner.put(f"{API}/nutrition/profile", json=PROFILE)
    owner.put(
        f"{API}/nutrition/target", json={"kcal": 2260, "protein": 165, "carbs": 245, "fat": 70}
    )
    day = today(owner)
    photo = owner.post(
        f"{API}/nutrition/photos", files={"file": ("lunch.jpg", photo_bytes(), "image/jpeg")}
    ).json()["id"]
    owner.post(f"{API}/nutrition/meals", json=meal(day, photo_ids=[photo], remember=True))
    owner.put(f"{API}/nutrition/weigh-ins", json={"day": day, "weight_kg": 82.1})
    _ready, raw = export(owner)
    preview = upload(owner, raw)
    assert preview.status_code == 200, preview.text
    assert preview.json()["counts"]["meals"] == 1
    restored = owner.post(
        f"{API}/backups/import",
        json={
            "token": preview.json()["token"],
            "mode": "replace",
            "confirmation": "REPLACE MY NOTES",
        },
    )
    assert restored.status_code == 200, restored.text
    state = owner.get(f"{API}/nutrition").json()
    assert state["target"]["kcal"] == 2260 and state["profile"]["weight_kg"] == 82.4
    assert [item["name"] for item in state["saved_meals"]] == ["Oats"]
    assert state["weigh_ins"] == [{"day": day, "weight_kg": 82.1}]
    meals = owner.get(f"{API}/nutrition/meals?start={day}&end={day}").json()
    assert len(meals) == 1 and meals[0]["saved_meal_id"] == state["saved_meals"][0]["id"]
    image = owner.get(f"{API}/nutrition/photos/{meals[0]['photo_ids'][0]}")
    assert image.status_code == 200 and image.headers["content-type"] == "image/webp"
