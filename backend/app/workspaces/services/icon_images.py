from collections.abc import Buffer
from io import BytesIO
from threading import BoundedSemaphore

from PIL import Image, ImageOps, ImageSequence
from starlette.datastructures import UploadFile

from app.core.errors import ContentTooLargeError, ValidationError
from app.core.storage_limits import MAX_ICON_SIZE
from app.storage.media import inspect_image

ICON_SIZE = (512, 512)
MAX_ICON_FRAMES = 200
MAX_DECODED_PIXELS = 64_000_000
processing_lock = BoundedSemaphore(1)


class IconBuffer(BytesIO):
    def write(self, data: Buffer, /) -> int:
        if self.tell() + memoryview(data).nbytes > MAX_ICON_SIZE:
            raise ContentTooLargeError("The resized icon exceeds 5 MB. Choose a shorter GIF.")
        return super().write(data)


def normalize_icon(upload: UploadFile, target_size: tuple[int, int] = ICON_SIZE) -> UploadFile:
    upload.file.seek(0, 2)
    size = upload.file.tell()
    upload.file.seek(0)
    if size > MAX_ICON_SIZE:
        raise ContentTooLargeError("Workspace images must be no larger than 5 MB.")
    inspect_image(upload, required=True)
    upload.file.seek(0)
    with processing_lock:
        output = IconBuffer()
        frames: list[Image.Image] = []
        try:
            with Image.open(upload.file) as image:
                durations = []
                loop = image.info.get("loop")
                animated = getattr(image, "is_animated", False) or image.format == "GIF"
                decoded_pixels = 0
                for index, frame in enumerate(ImageSequence.Iterator(image)):
                    decoded_pixels += frame.width * frame.height
                    if index >= MAX_ICON_FRAMES or decoded_pixels > MAX_DECODED_PIXELS:
                        raise ValidationError(
                            "This animation is too long or large. Choose a shorter or smaller GIF."
                        )
                    if frame.width * frame.height > 16_000_000:
                        raise ValidationError("Images must be smaller than 16 megapixels.")
                    oriented = ImageOps.exif_transpose(frame)
                    try:
                        rgba = oriented.convert("RGBA")
                        try:
                            frames.append(rgba.resize(target_size, Image.Resampling.LANCZOS))
                        finally:
                            rgba.close()
                    finally:
                        oriented.close()
                    durations.append(frame.info.get("duration", 100))
                if animated:
                    frames[0].save(
                        output,
                        format="GIF",
                        save_all=True,
                        append_images=frames[1:],
                        duration=durations,
                        disposal=2,
                        optimize=True,
                        **({"loop": loop} if loop is not None else {}),
                    )
                else:
                    frames[0].save(output, format="PNG", optimize=True)
            size = output.tell()
            output.seek(0)
            return UploadFile(output, filename="icon.gif" if animated else "icon.png", size=size)
        except (OSError, ValueError, EOFError) as error:
            output.close()
            raise ValidationError(
                "This image could not be resized. Choose another image or GIF."
            ) from error
        except BaseException:
            output.close()
            raise
        finally:
            for frame in frames:
                frame.close()
