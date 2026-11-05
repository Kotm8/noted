import warnings
from io import BytesIO
from pathlib import Path
from threading import Semaphore
from uuid import UUID

from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic_ai.messages import BinaryContent
from sqlalchemy.orm import Session

from app.ai.knowledge.schemas import IMAGE_TYPES
from app.core.errors import NotFoundError, ValidationError
from app.notes.models import Attachment
from app.notes.services.messages import MessageService
from app.storage.local import STORAGE_KEY

_encoding = Semaphore(1)


def load_image(db: Session, directory: Path, owner_id: UUID, identifier: UUID) -> BinaryContent:
    attachment = db.get(Attachment, identifier)
    if attachment is None:
        raise NotFoundError("Picture not found")
    MessageService(db).get_message(attachment.message_id, owner_id)
    if attachment.content_type not in IMAGE_TYPES:
        raise ValidationError("AI can view JPEG, PNG, WebP and GIF pictures.")
    if not STORAGE_KEY.fullmatch(attachment.storage_key):
        raise NotFoundError("Picture not found")
    path = (directory / attachment.storage_key).resolve()
    if not path.is_relative_to(directory.resolve()) or not path.is_file():
        raise NotFoundError("The picture is missing from storage.")
    if path.stat().st_size > 32 * 1024 * 1024:
        raise ValidationError("This picture is too large for AI. Use a copy under 32 MB.")
    with _encoding, warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        try:
            with Image.open(path, formats=["JPEG", "PNG", "WEBP", "GIF"]) as image:
                if image.width * image.height > 16_000_000:
                    raise ValidationError("This picture is too large for AI. Use a smaller copy.")
                image.seek(0)
                frame = ImageOps.exif_transpose(image)
                try:
                    frame.thumbnail((2048, 2048))
                    output = BytesIO()
                    frame.save(output, format="WEBP", quality=90)
                    return BinaryContent(
                        output.getvalue(), media_type="image/webp", identifier=str(identifier)
                    )
                finally:
                    frame.close()
        except (
            UnidentifiedImageError,
            OSError,
            Image.DecompressionBombWarning,
            Image.DecompressionBombError,
        ):
            raise ValidationError(
                "This picture could not be read. Try uploading it again."
            ) from None
