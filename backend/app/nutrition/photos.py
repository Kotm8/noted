from uuid import UUID, uuid4

from pydantic_ai.messages import BinaryContent
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import UploadFile

from app.core.errors import ContentTooLargeError, ValidationError
from app.core.security import utc_now
from app.core.storage_limits import MAX_PHOTO_SIZE
from app.notes.images.encoding import MAX_PREVIEW_BYTES, encode_preview
from app.notes.images.service import preview_bytes
from app.nutrition.models import MealPhoto, SavedMealPhoto
from app.nutrition.photo_references import retained_photo, unused_file_keys
from app.nutrition.service import NutritionService
from app.storage.base import FileStorage
from app.storage.media import inspect_image

MAX_UNSAVED_PHOTOS = 20


async def store_photo(
    db: Session, storage: FileStorage, owner_id: UUID, upload: UploadFile
) -> MealPhoto:
    """Keeps only a 1280px WebP of the photo: enough to show the meal and to estimate it."""
    if upload.size is not None and upload.size > MAX_PHOTO_SIZE:
        raise ContentTooLargeError("Photos must be no larger than 25 MB.")
    unsaved = db.scalar(
        select(func.count()).where(
            MealPhoto.owner_id == owner_id, MealPhoto.meal_id.is_(None), ~retained_photo()
        )
    )
    if (unsaved or 0) >= MAX_UNSAVED_PHOTOS:
        await remove_stale(db, storage, owner_id)
        unsaved = db.scalar(
            select(func.count()).where(
                MealPhoto.owner_id == owner_id, MealPhoto.meal_id.is_(None), ~retained_photo()
            )
        )
        if (unsaved or 0) >= MAX_UNSAVED_PHOTOS:
            raise ValidationError(
                "Save or discard the meals you're logging before adding more photos."
            )
    try:
        await run_in_threadpool(inspect_image, upload, True)
    finally:
        await upload.seek(0)
    preview = await run_in_threadpool(encode_preview, upload.file)
    identifier = uuid4().hex
    key = f"{identifier[:2]}/{identifier}"
    size = await storage.save(key, preview_bytes(preview.data), MAX_PREVIEW_BYTES)
    photo = MealPhoto(
        owner_id=owner_id, storage_key=key, size=size, width=preview.width, height=preview.height
    )
    db.add(photo)
    db.flush()
    await remove_stale(db, storage, owner_id)
    return photo


async def remove_stale(db: Session, storage: FileStorage, owner_id: UUID) -> None:
    candidates = []
    for photo in NutritionService(db).stale_photos(owner_id, utc_now()):
        if db.scalar(
            select(SavedMealPhoto.photo_id).where(SavedMealPhoto.photo_id == photo.id).limit(1)
        ):
            continue
        candidates.append(photo.storage_key)
        db.delete(photo)
    db.flush()
    for key in unused_file_keys(db, candidates):
        await storage.delete(key)


async def photo_content(storage: FileStorage, photo: MealPhoto) -> BinaryContent:
    data = b"".join([chunk async for chunk in storage.read(photo.storage_key)])
    return BinaryContent(data, media_type="image/webp", identifier=str(photo.id))
