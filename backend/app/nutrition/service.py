from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Any
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.core.security import utc_now
from app.habits.repository import HabitRepository
from app.nutrition import energy
from app.nutrition.models import (
    Meal,
    MealPhoto,
    NutritionProfile,
    NutritionTarget,
    SavedMeal,
    WeighIn,
)
from app.nutrition.schemas import (
    DaySummary,
    LimitsResponse,
    MealFields,
    MealResponse,
    MealUpdate,
    NutritionState,
    ProfileFields,
    ProfileResponse,
    SavedMealFields,
    SavedMealResponse,
    SavedMealUpdate,
    TargetFields,
    TargetResponse,
    TrainingActivity,
    TrainingSummary,
    WeighInInput,
    WeighInResponse,
)
from app.time_tracking.models import TrackerState
from app.time_tracking.repository import TrackingRepository

MAX_SAVED_MEALS = 200
MAX_MEALS_PER_DAY = 30
PHOTO_GRACE = timedelta(days=1)
# A target's calories and its macros should roughly agree.
MACRO_TOLERANCE = 0.15


def limits_for(profile: ProfileFields | NutritionProfile, today: date) -> LimitsResponse:
    age = (
        energy.current_age(profile.age, profile.age_given_on, today)
        if isinstance(profile, NutritionProfile)
        else profile.age
    )
    found = energy.limits(
        profile.sex, profile.weight_kg, profile.height_cm, age, profile.activity, profile.pregnant
    )
    return LimitsResponse(
        resting=found.resting,
        maintenance=found.maintenance,
        lowest=found.lowest,
        highest=found.highest,
        reason=found.reason,
        factor=energy.ACTIVITY_FACTORS[profile.activity],
        age=age,
    )


def totals(items: list[dict[str, Any]]) -> dict[str, float]:
    return {
        key: sum(float(item.get(key, 0)) for item in items)
        for key in ("kcal", "protein", "carbs", "fat")
    }


class NutritionService:
    def __init__(self, db: Session) -> None:
        self.db = db

    # The day boundary is local midnight in the owner's schedule timezone.
    def timezone(self, owner_id: UUID) -> str:
        state = self.db.get(TrackerState, owner_id)
        return state.timezone if state else "UTC"

    def today(self, owner_id: UUID) -> date:
        return utc_now().astimezone(ZoneInfo(self.timezone(owner_id))).date()

    def state(self, owner_id: UUID) -> NutritionState:
        today = self.today(owner_id)
        profile = self.db.get(NutritionProfile, owner_id)
        target = self.target_on(owner_id, today)
        weigh_ins = self.db.scalars(
            select(WeighIn)
            .where(WeighIn.owner_id == owner_id, WeighIn.day >= today - timedelta(days=90))
            .order_by(WeighIn.day)
        )
        return NutritionState(
            today=today,
            timezone=self.timezone(owner_id),
            profile=ProfileResponse.model_validate(profile, from_attributes=True)
            if profile
            else None,
            target=TargetResponse.model_validate(target) if target else None,
            limits=limits_for(profile, today) if profile else None,
            saved_meals=[SavedMealResponse.model_validate(item) for item in self.saved(owner_id)],
            weigh_ins=[WeighInResponse.model_validate(item) for item in weigh_ins],
        )

    # Profile and targets.

    def save_profile(self, owner_id: UUID, data: ProfileFields) -> NutritionProfile:
        profile = self.db.get(NutritionProfile, owner_id)
        today = self.today(owner_id)
        if profile is None:
            profile = NutritionProfile(
                owner_id=owner_id, revision=0, **data.model_dump(), age_given_on=today
            )
            self.db.add(profile)
        else:
            for key, value in data.model_dump().items():
                setattr(profile, key, value)
            profile.age_given_on = today
        profile.revision += 1
        profile.updated_at = utc_now()
        self.db.flush()
        return profile

    def target_on(self, owner_id: UUID, day: date) -> NutritionTarget | None:
        return self.db.scalar(
            select(NutritionTarget)
            .where(NutritionTarget.owner_id == owner_id, NutritionTarget.starts_on <= day)
            .order_by(NutritionTarget.starts_on.desc())
            .limit(1)
        )

    def accept_target(self, owner_id: UUID, data: TargetFields) -> NutritionTarget:
        profile = self.db.get(NutritionProfile, owner_id)
        if profile is None:
            raise ValidationError("Set up your profile first.")
        today = self.today(owner_id)
        bounds = limits_for(profile, today)
        if data.kcal < bounds.lowest:
            raise ValidationError(bounds.reason)
        if data.kcal > bounds.highest:
            raise ValidationError(
                f"Keep the target at or under {bounds.highest:,} kcal, 15% above maintenance."
            )
        made = energy.macro_energy(data.protein, data.carbs, data.fat)
        if abs(made - data.kcal) > data.kcal * MACRO_TOLERANCE:
            raise ValidationError(
                f"Protein, carbs and fat add up to {round(made):,} kcal. "
                f"Bring them within {round(MACRO_TOLERANCE * 100)}% of {data.kcal:,}."
            )
        target = self.db.scalar(
            select(NutritionTarget).where(
                NutritionTarget.owner_id == owner_id, NutritionTarget.starts_on == today
            )
        )
        if target is None:
            target = NutritionTarget(owner_id=owner_id, starts_on=today)
            self.db.add(target)
        target.resting, target.maintenance = bounds.resting, bounds.maintenance
        target.kcal, target.protein, target.carbs, target.fat = (
            data.kcal,
            data.protein,
            data.carbs,
            data.fat,
        )
        target.explanation = data.explanation
        target.sources = [item.model_dump() for item in data.sources]
        target.created_at = utc_now()
        self.db.flush()
        return target

    def training(self, owner_id: UUID) -> TrainingSummary:
        """How the owner trains, from the last 28 days of tracked time and their habits."""
        end = utc_now()
        start = end - timedelta(days=28)
        zone = ZoneInfo(self.timezone(owner_id))
        tracking = TrackingRepository(self.db)
        names = {item.id: item.name for item in tracking.activities(owner_id)}
        minutes: dict[UUID, list[float]] = defaultdict(list)
        days: dict[UUID, set[date]] = defaultdict(set)
        for session in tracking.sessions(owner_id, start, end):
            finish = session.ended_at or end
            minutes[session.activity_id].append((finish - session.started_at).total_seconds() / 60)
            days[session.activity_id].add(session.started_at.astimezone(zone).date())
        activities = [
            TrainingActivity(
                name=names.get(activity, "Activity"),
                sessions=len(spans),
                days=len(days[activity]),
                average_minutes=round(sum(spans) / len(spans)),
            )
            for activity, spans in sorted(minutes.items(), key=lambda pair: -sum(pair[1]))
        ][:15]
        habits = [item.name for item in HabitRepository(self.db).all(owner_id)][:20]
        return TrainingSummary(activities=activities, habits=habits)

    # Meals.

    def _meal(self, owner_id: UUID, meal_id: UUID) -> Meal:
        meal = self.db.get(Meal, meal_id)
        if meal is None or meal.owner_id != owner_id:
            raise NotFoundError("This meal no longer exists.")
        return meal

    def response(self, meal: Meal) -> MealResponse:
        photos = self.db.scalars(
            select(MealPhoto.id).where(MealPhoto.meal_id == meal.id).order_by(MealPhoto.created_at)
        )
        return MealResponse.model_validate(
            {
                **{
                    key: getattr(meal, key)
                    for key in MealResponse.model_fields
                    if key != "photo_ids"
                },
                "photo_ids": list(photos),
            }
        )

    def meals(self, owner_id: UUID, start: date, end: date) -> list[MealResponse]:
        if (end - start).days > 62:
            raise ValidationError("Ask for up to two months of meals at a time.")
        rows = self.db.scalars(
            select(Meal)
            .where(Meal.owner_id == owner_id, Meal.day >= start, Meal.day <= end)
            .order_by(Meal.day, Meal.minute, Meal.created_at)
        )
        return [self.response(meal) for meal in rows]

    def days(self, owner_id: UUID, start: date, end: date) -> list[DaySummary]:
        if (end - start).days > 366:
            raise ValidationError("Ask for up to a year at a time.")
        found: dict[date, list[Meal]] = defaultdict(list)
        for meal in self.db.scalars(
            select(Meal).where(Meal.owner_id == owner_id, Meal.day >= start, Meal.day <= end)
        ):
            found[meal.day].append(meal)
        targets = list(
            self.db.scalars(
                select(NutritionTarget)
                .where(NutritionTarget.owner_id == owner_id, NutritionTarget.starts_on <= end)
                .order_by(NutritionTarget.starts_on)
            )
        )
        summaries = []
        day = start
        while day <= end:
            meals = found.get(day, [])
            sums = totals([item for meal in meals for item in meal.items])
            target = next((item for item in reversed(targets) if item.starts_on <= day), None)
            summaries.append(
                DaySummary(
                    day=day,
                    kcal=round(sums["kcal"]),
                    protein=round(sums["protein"], 1),
                    carbs=round(sums["carbs"], 1),
                    fat=round(sums["fat"], 1),
                    meals=len(meals),
                    target=target.kcal if target else None,
                )
            )
            day += timedelta(days=1)
        return summaries

    def _attach_photos(self, owner_id: UUID, meal: Meal, photo_ids: list[UUID]) -> None:
        current = {
            photo.id: photo
            for photo in self.db.scalars(select(MealPhoto).where(MealPhoto.meal_id == meal.id))
        }
        for photo_id in photo_ids:
            photo = current.pop(photo_id, None) or self.db.get(MealPhoto, photo_id)
            if photo is None or photo.owner_id != owner_id:
                raise NotFoundError("A photo is no longer available. Add it again.")
            if photo.meal_id not in (None, meal.id):
                raise ValidationError("That photo belongs to another meal.")
            photo.meal_id = meal.id
        # Photos taken off the meal become unattached and are cleaned up later.
        for photo in current.values():
            photo.meal_id = None
            photo.created_at = utc_now()

    def _remember(self, owner_id: UUID, meal: Meal, data: MealFields) -> None:
        if data.saved_meal_id:
            saved = self.db.get(SavedMeal, data.saved_meal_id)
            if saved is None or saved.owner_id != owner_id:
                raise NotFoundError("That saved meal no longer exists.")
            saved.uses += 1
            saved.last_used_at = utc_now()
            meal.saved_meal_id = saved.id
        elif data.remember:
            saved = self.add_saved(owner_id, SavedMealFields(name=data.name, items=data.items))
            saved.uses = 1
            saved.last_used_at = utc_now()
            meal.saved_meal_id = saved.id

    def add_meal(self, owner_id: UUID, data: MealFields) -> Meal:
        count = len(
            list(
                self.db.scalars(
                    select(Meal.id).where(Meal.owner_id == owner_id, Meal.day == data.day)
                )
            )
        )
        if count >= MAX_MEALS_PER_DAY:
            raise ValidationError("A day holds up to 30 meals.")
        meal = Meal(
            owner_id=owner_id,
            day=data.day,
            minute=data.minute,
            slot=data.slot,
            name=data.name.strip(),
            items=[item.model_dump() for item in data.items],
            source=data.source,
        )
        self.db.add(meal)
        self.db.flush()
        self._remember(owner_id, meal, data)
        self._attach_photos(owner_id, meal, data.photo_ids)
        self.db.flush()
        return meal

    def edit_meal(self, owner_id: UUID, meal_id: UUID, data: MealUpdate) -> Meal:
        meal = self._meal(owner_id, meal_id)
        if meal.revision != data.revision:
            raise ConflictError("This meal changed on another device. Reload it and try again.")
        meal.day, meal.minute, meal.slot = data.day, data.minute, data.slot
        meal.name = data.name.strip()
        meal.items = [item.model_dump() for item in data.items]
        if data.remember and not meal.saved_meal_id:
            self._remember(owner_id, meal, data)
        self._attach_photos(owner_id, meal, data.photo_ids)
        meal.revision += 1
        self.db.flush()
        return meal

    def remove_meal(self, owner_id: UUID, meal_id: UUID, revision: int) -> list[str]:
        """Deletes the meal and its photos, returning the photo files to remove."""
        meal = self._meal(owner_id, meal_id)
        if meal.revision != revision:
            raise ConflictError("This meal changed on another device. Reload it and try again.")
        photos = list(self.db.scalars(select(MealPhoto).where(MealPhoto.meal_id == meal.id)))
        keys = [photo.storage_key for photo in photos]
        for photo in photos:
            self.db.delete(photo)
        self.db.delete(meal)
        self.db.flush()
        return keys

    # Saved meals.

    def saved(self, owner_id: UUID) -> list[SavedMeal]:
        return list(
            self.db.scalars(
                select(SavedMeal)
                .where(SavedMeal.owner_id == owner_id)
                .order_by(SavedMeal.uses.desc(), SavedMeal.name)
            )
        )

    def add_saved(self, owner_id: UUID, data: SavedMealFields) -> SavedMeal:
        existing = self.saved(owner_id)
        if len(existing) >= MAX_SAVED_MEALS:
            raise ValidationError("Keep up to 200 saved meals.")
        name = data.name.strip()
        if any(item.name.lower() == name.lower() for item in existing):
            raise ValidationError(f"You already have a saved meal called “{name}”.")
        saved = SavedMeal(
            owner_id=owner_id, name=name, items=[item.model_dump() for item in data.items]
        )
        self.db.add(saved)
        self.db.flush()
        return saved

    def _saved(self, owner_id: UUID, saved_id: UUID) -> SavedMeal:
        saved = self.db.get(SavedMeal, saved_id)
        if saved is None or saved.owner_id != owner_id:
            raise NotFoundError("That saved meal no longer exists.")
        return saved

    def edit_saved(self, owner_id: UUID, saved_id: UUID, data: SavedMealUpdate) -> SavedMeal:
        saved = self._saved(owner_id, saved_id)
        if saved.revision != data.revision:
            raise ConflictError(
                "This saved meal changed on another device. Reload it and try again."
            )
        name = data.name.strip()
        if any(
            item.id != saved.id and item.name.lower() == name.lower()
            for item in self.saved(owner_id)
        ):
            raise ValidationError(f"You already have a saved meal called “{name}”.")
        saved.name = name
        saved.items = [item.model_dump() for item in data.items]
        saved.revision += 1
        self.db.flush()
        return saved

    def remove_saved(self, owner_id: UUID, saved_id: UUID) -> None:
        self.db.delete(self._saved(owner_id, saved_id))
        self.db.flush()

    # Weight.

    def weigh_in(self, owner_id: UUID, data: WeighInInput) -> WeighIn:
        found = self.db.get(WeighIn, (owner_id, data.day))
        if found is None:
            found = WeighIn(owner_id=owner_id, day=data.day, weight_kg=data.weight_kg)
            self.db.add(found)
        else:
            found.weight_kg = data.weight_kg
        self.db.flush()
        return found

    def remove_weigh_in(self, owner_id: UUID, day: date) -> None:
        self.db.execute(delete(WeighIn).where(WeighIn.owner_id == owner_id, WeighIn.day == day))

    # Photos.

    def photo(self, owner_id: UUID, photo_id: UUID) -> MealPhoto:
        photo = self.db.get(MealPhoto, photo_id)
        if photo is None or photo.owner_id != owner_id:
            raise NotFoundError("This photo is no longer available.")
        return photo

    def stale_photos(self, owner_id: UUID, now: datetime) -> list[MealPhoto]:
        return list(
            self.db.scalars(
                select(MealPhoto).where(
                    MealPhoto.owner_id == owner_id,
                    MealPhoto.meal_id.is_(None),
                    MealPhoto.created_at < now - PHOTO_GRACE,
                )
            )
        )
