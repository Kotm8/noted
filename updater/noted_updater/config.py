from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

from .files import read_json
from .release import REPOSITORY


@dataclass(frozen=True)
class Config:
    directory: Path
    repository: str
    project: str = "noted"
    token_file: Path | None = None
    check_seconds: int = 86400

    @property
    def control(self) -> Path:
        return self.directory / "updater"

    @property
    def state(self) -> Path:
        return self.control / "state"

    @property
    def requests(self) -> Path:
        return self.control / "requests"

    @property
    def maintenance(self) -> Path:
        return self.control / "maintenance" / "enabled"

    @classmethod
    def load(cls, path: Path) -> "Config":
        data = read_json(path)
        repository = str(data["repository"]).lower()
        directory = Path(data["directory"]).resolve(strict=True)
        if not REPOSITORY.fullmatch(repository):
            raise ValueError("Use a GitHub repository in owner/name format")
        if data.get("project", "noted") != "noted":
            raise ValueError("The production Compose project must remain noted")
        if not (directory / ".env").is_file():
            raise ValueError("The installation environment file is missing")
        token_file = (
            Path(data["token_file"]).resolve(strict=True) if data.get("token_file") else None
        )
        return cls(directory, repository, "noted", token_file)


def validate_origin(value: str) -> str:
    parsed = urlsplit(value)
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("The installed app must have a public HTTPS origin")
    return value.rstrip("/")
