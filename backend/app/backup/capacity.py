import ctypes
import os
import shutil
from pathlib import Path

from app.core.errors import ContentTooLargeError


def require_space(path: Path, additional: int) -> None:
    target = path
    while not target.exists():
        target = target.parent
    usage = shutil.disk_usage(target)
    reserve = min(256 * 1024 * 1024, usage.total // 100)
    if additional + reserve > usage.free:
        raise ContentTooLargeError("There is not enough free disk space for this backup operation.")


def available_memory() -> int:
    if os.name == "nt":

        class Status(ctypes.Structure):
            _fields_ = [("length", ctypes.c_ulong), ("load", ctypes.c_ulong)] + [
                (name, ctypes.c_ulonglong)
                for name in (
                    "total_physical",
                    "available_physical",
                    "total_page",
                    "available_page",
                    "total_virtual",
                    "available_virtual",
                    "extended",
                )
            ]

        status = Status()
        status.length = ctypes.sizeof(status)
        if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
            return int(status.available_physical)
    limits = []
    try:
        memory = dict(line.split(":", 1) for line in Path("/proc/meminfo").read_text().splitlines())
        limits.append(int(memory["MemAvailable"].split()[0]) * 1024)
    except (OSError, KeyError, ValueError):
        pass
    for maximum, current in (
        ("/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory.current"),
        (
            "/sys/fs/cgroup/memory/memory.limit_in_bytes",
            "/sys/fs/cgroup/memory/memory.usage_in_bytes",
        ),
    ):
        try:
            limits.append(max(0, int(Path(maximum).read_text()) - int(Path(current).read_text())))
        except (OSError, ValueError):
            pass
    return min(limits) if limits else 512 * 1024 * 1024


def require_memory(estimated: int) -> None:
    if estimated > available_memory() * 3 // 4:
        raise ContentTooLargeError(
            "This backup's metadata needs more available memory. "
            "Free memory or import on a larger instance."
        )
