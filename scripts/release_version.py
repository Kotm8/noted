import json
import re
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def release_version(root: Path = ROOT) -> str:
    versions = {}
    for name in (
        "apps/web/package.json",
        "apps/desktop/package.json",
        "apps/desktop/src-tauri/tauri.conf.json",
    ):
        versions[name] = json.loads((root / name).read_text())["version"]
    versions["backend"] = tomllib.loads((root / "backend/pyproject.toml").read_text())["project"][
        "version"
    ]
    versions["desktop"] = tomllib.loads((root / "apps/desktop/src-tauri/Cargo.toml").read_text())[
        "package"
    ]["version"]
    android = re.search(
        r'versionName\s*=\s*"([^"]+)"',
        (root / "apps/android/app/build.gradle.kts").read_text(),
    )
    if android is None:
        raise ValueError("Android versionName is missing")
    versions["android"] = android.group(1)
    for module in ("wear", "watchface"):
        match = re.search(
            r'versionName\s*=\s*"([^"]+)"',
            (root / f"apps/android/{module}/build.gradle.kts").read_text(),
        )
        if match is None:
            raise ValueError(f"Android {module} versionName is missing")
        versions[module] = match.group(1)
    if len(set(versions.values())) != 1:
        raise ValueError(f"Release versions disagree: {versions}")
    version = versions["android"]
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise ValueError("Use a stable major.minor.patch release version")
    return version


if __name__ == "__main__":
    print(release_version())
