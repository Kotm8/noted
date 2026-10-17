import warnings

from PIL import Image, UnidentifiedImageError
from starlette.datastructures import UploadFile

from app.core.errors import ValidationError

IMAGE_TYPES = {"PNG": "image/png", "JPEG": "image/jpeg", "GIF": "image/gif", "WEBP": "image/webp"}
VIDEO_TYPES = {"video/mp4", "video/webm", "video/quicktime"}
VIDEO_EXTENSIONS = (".mp4", ".m4v", ".webm", ".mov")
MP4_BRANDS = {
    b"isom",
    b"iso2",
    b"iso3",
    b"iso4",
    b"iso5",
    b"iso6",
    b"mp41",
    b"mp42",
    b"avc1",
    b"dash",
    b"M4V ",
    b"MSNV",
}


def read_ebml_integer(data: bytes, offset: int, keep_marker: bool = False) -> tuple[int, int]:
    if offset >= len(data) or not data[offset]:
        raise ValueError("Invalid EBML integer")
    width = 9 - data[offset].bit_length()
    end = offset + width
    if end > len(data) or (keep_marker and width > 4):
        raise ValueError("Incomplete EBML integer")
    value = int.from_bytes(data[offset:end], "big")
    if not keep_marker:
        value &= (1 << (7 * width)) - 1
    return value, end


def is_webm(header: bytes) -> bool:
    if not header.startswith(b"\x1a\x45\xdf\xa3"):
        return False
    try:
        length, offset = read_ebml_integer(header, 4)
        end = offset + length
        if end > len(header):
            return False
        while offset < end:
            identifier, offset = read_ebml_integer(header, offset, keep_marker=True)
            length, offset = read_ebml_integer(header, offset)
            next_offset = offset + length
            if next_offset > end:
                return False
            if identifier == 0x4282:
                return header[offset:next_offset].rstrip(b"\0") == b"webm"
            offset = next_offset
    except ValueError:
        return False
    return False


def detect_video_type(header: bytes) -> str | None:
    if is_webm(header):
        return "video/webm"
    if len(header) >= 16 and header[4:8] == b"ftyp":
        box_size = int.from_bytes(header[:4], "big")
        if 16 <= box_size <= len(header):
            brand = header[8:12]
            if brand in MP4_BRANDS:
                return "video/mp4"
            if brand == b"qt  ":
                return "video/quicktime"
    return None


def has_video_playback(content_type: str, filename: str) -> bool:
    return content_type in VIDEO_TYPES or (
        content_type == "application/octet-stream" and filename.lower().endswith(VIDEO_EXTENSIONS)
    )


def inspect_image(upload: UploadFile, required: bool) -> str:
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(upload.file, formats=list(IMAGE_TYPES)) as image:
                if image.width * image.height > 16_000_000:
                    raise ValidationError("Images must be smaller than 16 megapixels.")
                content_type = IMAGE_TYPES[image.format or ""]
                image.verify()
                return content_type
    except (UnidentifiedImageError, OSError, KeyError):
        if required or (upload.content_type or "").startswith("image/"):
            raise ValidationError("Choose a valid PNG, JPEG, GIF, or WebP image.") from None
        return "application/octet-stream"
    except (Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise ValidationError("This image is too large to preview safely.") from None


def inspect_media(upload: UploadFile, image_only: bool) -> str:
    content_type = inspect_image(upload, image_only)
    if content_type != "application/octet-stream":
        return content_type
    upload.file.seek(0)
    return detect_video_type(upload.file.read(4096)) or content_type
