from uuid import UUID

from sqlalchemy import String, cast, delete, exists, func, or_, select
from sqlalchemy.orm import Session
from sqlalchemy.sql.elements import ColumnElement

from app.core.errors import NotFoundError
from app.core.security import utc_now
from app.nutrition.models import MealPhoto, SavedMealPhoto


def saved_photo_ids(db: Session, saved_id: UUID) -> list[UUID]:
    return list(
        db.scalars(
            select(SavedMealPhoto.photo_id)
            .where(
                SavedMealPhoto.saved_meal_id == saved_id,
            )
            .order_by(SavedMealPhoto.position)
        )
    )


def retained_photo() -> ColumnElement[bool]:
    from app.ai.assistant.models import AssistantTurn

    return or_(
        exists().where(SavedMealPhoto.photo_id == MealPhoto.id),
        exists().where(
            AssistantTurn.owner_id == MealPhoto.owner_id,
            AssistantTurn.photo_ids.contains(func.jsonb_build_array(cast(MealPhoto.id, String))),
        ),
    )


def save_photo_links(db: Session, owner_id: UUID, saved_id: UUID, ids: list[UUID]) -> None:
    photos = []
    for photo_id in dict.fromkeys(ids):
        photo = db.scalar(select(MealPhoto).where(MealPhoto.id == photo_id).with_for_update())
        if photo is None or photo.owner_id != owner_id:
            raise NotFoundError("A photo is no longer available. Add it again.")
        photos.append(photo)
    old = saved_photo_ids(db, saved_id)
    db.execute(delete(SavedMealPhoto).where(SavedMealPhoto.saved_meal_id == saved_id))
    for position, photo in enumerate(photos):
        db.add(
            SavedMealPhoto(
                saved_meal_id=saved_id, photo_id=photo.id, owner_id=owner_id, position=position
            )
        )
    for photo_id in set(old) - set(ids):
        photo = db.get(MealPhoto, photo_id)
        if photo is not None and photo.meal_id is None:
            photo.created_at = utc_now()
    db.flush()


def unused_file_keys(db: Session, candidates: list[str]) -> list[str]:
    from app.finance.models import FinanceAsset

    return [
        key
        for key in dict.fromkeys(candidates)
        if not db.scalar(select(MealPhoto.id).where(MealPhoto.storage_key == key).limit(1))
        and not db.scalar(select(FinanceAsset.id).where(FinanceAsset.storage_key == key).limit(1))
    ]
