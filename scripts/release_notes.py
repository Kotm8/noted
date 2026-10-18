import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def release_notes(version: str, changelog: Path | None = None) -> str:
    path = changelog if changelog is not None else ROOT / "CHANGELOG.md"
    if not path.is_file():
        raise ValueError("CHANGELOG.md is missing. Add release notes before publishing.")
    sections: list[list[str]] = []
    current: list[str] | None = None
    fence = ""
    heading_pattern = re.compile(r"^##[ \t]+(.+?)[ \t]*$")
    version_pattern = re.compile(rf"^(?:{re.escape(version)}|\[{re.escape(version)}\])(?: - .+)?$")
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        marker = re.match(r"^ {0,3}(`{3,}|~{3,})", line)
        if marker:
            token = marker.group(1)
            if not fence:
                fence = token
            elif (
                token[0] == fence[0]
                and len(token) >= len(fence)
                and not line[marker.end() :].strip()
            ):
                fence = ""
        elif not fence and (heading := heading_pattern.fullmatch(line)):
            current = [] if version_pattern.fullmatch(heading.group(1)) else None
            if current is not None:
                sections.append(current)
            continue
        if current is not None:
            current.append(line)
    if not sections:
        raise ValueError(f"CHANGELOG.md has no '## {version}' entry.")
    if len(sections) != 1:
        raise ValueError(f"CHANGELOG.md has duplicate entries for {version}.")
    notes = "\n".join(sections[0]).strip()
    if not notes:
        raise ValueError(f"CHANGELOG.md entry for {version} is empty.")
    return notes
