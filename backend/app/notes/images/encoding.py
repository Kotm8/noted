import math
import warnings
from dataclasses import dataclass
from io import BytesIO
from threading import Semaphore
from typing import BinaryIO

from PIL import Image, ImageOps, ImageSequence, UnidentifiedImageError

from app.core.errors import ValidationError
from app.storage.media import IMAGE_TYPES

_encoding = Semaphore(1)
MAX_PREVIEW_BYTES = 8 * 1024 * 1024


@dataclass(frozen=True)
class ImagePreview:
    width: int
    height: int
    data: bytes


def encode_preview(source: BinaryIO) -> ImagePreview:
    with _encoding, warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        source.seek(0)
        try:
            with Image.open(source, formats=list(IMAGE_TYPES)) as image:
                if image.width * image.height > 16_000_000:
                    raise ValidationError("This image is too large to preview safely.")
                oriented = ImageOps.exif_transpose(image)
                width, height = oriented.size
                oriented.close()
                frame_count = getattr(image, "n_frames", 1)
                step = max(1, math.ceil(frame_count / 120))
                kept = math.ceil(frame_count / step)
                scale = min(1, (640 if frame_count > 1 else 1280) / max(width, height))
                if frame_count > 1:
                    scale = min(scale, math.sqrt(12_000_000 / (width * height * kept)))
                size = (max(1, round(width * scale)), max(1, round(height * scale)))
                frames: list[Image.Image] = []
                durations: list[int] = []
                loop = image.info.get("loop", 0)
                try:
                    for index, frame in enumerate(ImageSequence.Iterator(image)):
                        if index % step == 0:
                            picture = ImageOps.exif_transpose(frame).convert("RGBA")
                            picture.thumbnail(size, Image.Resampling.LANCZOS)
                            frames.append(picture)
                            durations.append(0)
                        durations[-1] += max(10, int(frame.info.get("duration", 100)))
                    output = BytesIO()
                    frames[0].save(
                        output,
                        format="WEBP",
                        quality=76,
                        method=3,
                        save_all=len(frames) > 1,
                        append_images=frames[1:],
                        duration=durations,
                        loop=loop,
                    )
                    if output.tell() > MAX_PREVIEW_BYTES:
                        raise ValidationError("This image preview is too large.")
                    return ImagePreview(width, height, output.getvalue())
                finally:
                    for frame in frames:
                        frame.close()
        except (
            UnidentifiedImageError,
            OSError,
            ValueError,
            Image.DecompressionBombError,
            Image.DecompressionBombWarning,
        ):
            raise ValidationError("The image could not be previewed.") from None
