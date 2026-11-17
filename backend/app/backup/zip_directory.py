import struct
from pathlib import Path

from app.backup.capacity import require_memory
from app.core.errors import ValidationError


def check_directory(path: Path) -> None:
    size = path.stat().st_size
    with path.open("rb") as source:
        source.seek(-22, 2)
        end = struct.unpack("<4s4H2IH", source.read(22))
        if end[0] != b"PK\x05\x06" or end[1] or end[2] or end[3] != end[4] or end[7]:
            raise ValidationError("Choose a Noted ZIP without comments or multipart entries.")
        central_size, offset, finish = end[5], end[6], size - 22
        if size >= 98:
            source.seek(size - 42)
            locator = source.read(20)
            if locator[:4] == b"PK\x06\x07":
                _, disk, position, disks = struct.unpack("<4sIQI", locator)
                if disk or disks != 1 or position > size - 98:
                    raise ValidationError("Multipart ZIP backups are not supported.")
                source.seek(position)
                large = struct.unpack("<4sQ2H2I4Q", source.read(56))
                if (
                    large[0] != b"PK\x06\x06"
                    or large[1] < 44
                    or large[4]
                    or large[5]
                    or large[6] != large[7]
                    or position + large[1] + 12 != size - 42
                ):
                    raise ValidationError("The ZIP64 directory is invalid.")
                central_size, offset, finish = large[8], large[9], position
        if central_size + offset != finish:
            raise ValidationError("The ZIP directory does not match the archive.")
        require_memory(central_size * 12)
