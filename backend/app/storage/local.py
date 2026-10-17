import os
import re
from collections.abc import AsyncIterator
from pathlib import Path

import anyio

from app.core.errors import ContentTooLargeError

STORAGE_KEY = re.compile(r"[0-9a-f]{2}/[0-9a-f]{32}")


class LocalFileStorage:
    def __init__(self, directory: Path) -> None:
        self.directory = directory.resolve()
        self.directory.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        if not STORAGE_KEY.fullmatch(key) or key[:2] != key[3:5]:
            raise ValueError("Invalid storage key")
        return self.directory / key

    async def save(self, key: str, chunks: AsyncIterator[bytes], max_bytes: int) -> int:
        destination = self._path(key)
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_suffix(".part")
        size = 0

        try:
            async with await anyio.open_file(temporary, "xb") as file:
                async for chunk in chunks:
                    size += len(chunk)
                    if size > max_bytes:
                        raise ContentTooLargeError("This file exceeds the upload size limit.")
                    await file.write(chunk)
            os.replace(temporary, destination)
        finally:
            temporary.unlink(missing_ok=True)

        return size

    async def read(self, key: str, start: int = 0, end: int | None = None) -> AsyncIterator[bytes]:
        if start < 0 or (end is not None and end < start):
            raise ValueError("Invalid file range")
        async with await anyio.open_file(self._path(key), "rb") as file:
            await file.seek(start)
            remaining = None if end is None else end - start
            while remaining is None or remaining > 0:
                chunk = await file.read(65536 if remaining is None else min(65536, remaining))
                if not chunk:
                    break
                if remaining is not None:
                    remaining -= len(chunk)
                yield chunk

    async def exists(self, key: str) -> bool:
        return self._path(key).is_file()

    async def delete(self, key: str) -> None:
        self._path(key).unlink(missing_ok=True)
