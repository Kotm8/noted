import re
from dataclasses import dataclass


class UnsatisfiableRange(ValueError):
    pass


@dataclass(frozen=True)
class ByteRange:
    start: int
    end: int

    @property
    def length(self) -> int:
        return self.end - self.start + 1


def parse_byte_range(value: str | None, size: int) -> ByteRange | None:
    if value is None or not value.startswith("bytes=") or "," in value:
        return None
    match = re.fullmatch(r"bytes=([0-9]{0,20})-([0-9]{0,20})", value.strip())
    if match is None or size <= 0:
        raise UnsatisfiableRange
    first, last = match.groups()
    if not first:
        suffix = int(last or "0")
        if not suffix:
            raise UnsatisfiableRange
        return ByteRange(max(0, size - suffix), size - 1)
    start = int(first)
    end = min(int(last), size - 1) if last else size - 1
    if start >= size or end < start:
        raise UnsatisfiableRange
    return ByteRange(start, end)
