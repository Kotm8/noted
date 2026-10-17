import json
import os
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


def now() -> str:
    return datetime.now(UTC).isoformat()


def read_json(path: Path, maximum: int = 131072) -> dict[str, Any]:
    with path.open("rb") as file:
        raw = file.read(maximum + 1)
    if len(raw) > maximum:
        raise ValueError("State file is too large")
    value = json.loads(raw)
    if not isinstance(value, dict):
        raise ValueError("Expected a JSON object")
    return value


def write_json(path: Path, value: dict[str, Any], mode: int = 0o600) -> None:
    write_file(path, json.dumps(value, ensure_ascii=False, indent=2).encode(), mode)


def write_file(path: Path, value: bytes, mode: int = 0o600) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=".writing-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as file:
            file.write(value)
            file.flush()
            os.fsync(file.fileno())
        os.chmod(temporary, mode)
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)
