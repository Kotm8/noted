from uuid import UUID, uuid4

from sqlalchemy import func, select
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import UploadFile

from app.core.errors import ContentTooLargeError, NotFoundError, ValidationError
from app.finance.models import FinanceAsset
from app.notes.images.service import preview_bytes
from app.storage.base import FileStorage
from app.storage.media import inspect_image

MAX_FINANCE_PHOTO = 25 * 1024 * 1024


async def store_asset(
    db: Session, storage: FileStorage, owner: UUID, upload: UploadFile
) -> FinanceAsset:
    if upload.size is not None and upload.size > MAX_FINANCE_PHOTO:
        raise ContentTooLargeError("Images must be no larger than 25 MB")
    if (
        db.scalar(
            select(func.count()).select_from(FinanceAsset).where(FinanceAsset.owner_id == owner)
        )
        or 0
    ) >= 5000:
        raise ContentTooLargeError("This Finance library has reached its image limit")
    try:
        await run_in_threadpool(inspect_image, upload, True)
    finally:
        await upload.seek(0)
    data = await upload.read(MAX_FINANCE_PHOTO + 1)
    if len(data) > MAX_FINANCE_PHOTO:
        raise ContentTooLargeError("Images must be no larger than 25 MB")
    identifier = uuid4()
    key = f"{identifier.hex[:2]}/{identifier.hex}"
    from io import BytesIO

    from PIL import Image

    with Image.open(BytesIO(data)) as image:
        content_type = Image.MIME.get(image.format or "", "application/octet-stream")
    if content_type not in {"image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"}:
        raise ValidationError("Use a PNG, JPEG, WebP, GIF or AVIF image")
    size = await storage.save(key, preview_bytes(data), MAX_FINANCE_PHOTO)
    row = FinanceAsset(
        id=identifier,
        owner_id=owner,
        storage_key=key,
        size=size,
        content_type=content_type,
        filename=(upload.filename or "Image")[:200],
    )
    db.add(row)
    db.flush()
    return row


def retain_assistant_photo(db: Session, owner: UUID, identifier: UUID) -> None:
    from app.nutrition.models import MealPhoto

    asset = db.get(FinanceAsset, identifier)
    if asset is not None:
        if asset.owner_id != owner:
            raise NotFoundError("Finance image not found")
        return
    source = db.scalar(select(MealPhoto).where(MealPhoto.id == identifier).with_for_update())
    if source is None or source.owner_id != owner:
        raise NotFoundError("Finance image not found")
    db.add(
        FinanceAsset(
            id=identifier,
            owner_id=owner,
            storage_key=source.storage_key,
            size=source.size,
            content_type="image/webp",
            filename="Assistant image.webp",
        )
    )
    db.flush()
