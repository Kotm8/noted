import gzip
import hashlib
import io
import re
import tarfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from . import UPDATER_VERSION
from .files import write_file

COMMIT = re.compile(r"[0-9a-f]{40}")
DIGEST = re.compile(r"[0-9a-f]{64}")
REPOSITORY = re.compile(r"[a-z0-9][a-z0-9_.-]*/[a-z0-9][a-z0-9_.-]*")
BUNDLE_FILES = {"compose.production.yaml", "Caddyfile.production"}


@dataclass(frozen=True)
class Manifest:
    repository: str
    commit: str
    sequence: int
    version: str
    schema: str
    supported_schemas: tuple[str, ...]
    backend_image: str
    web_image: str
    bundle_sha256: str

    @classmethod
    def parse(cls, data: dict[str, Any], repository: str) -> "Manifest":
        if data.get("format") != 1 or data.get("channel") != "main":
            raise ValueError("Unsupported release format or channel")
        if data.get("repository") != repository or not REPOSITORY.fullmatch(repository):
            raise ValueError("The release belongs to another repository")
        if data.get("configuration_version") != 1 or data.get("api_version") != 1:
            raise ValueError("This release requires a different installer")
        minimum = data.get("minimum_updater_version")
        if type(minimum) is not int or not 1 <= minimum <= UPDATER_VERSION:
            raise ValueError("Upgrade the server update worker first")
        commit = data.get("commit", "")
        sequence = data.get("sequence")
        if not isinstance(commit, str) or not COMMIT.fullmatch(commit):
            raise ValueError("Invalid release commit")
        if type(sequence) is not int or not 1 <= sequence <= 9007199254740991:
            raise ValueError("Invalid release sequence")
        version = data.get("version", "")
        schema = data.get("schema_revision", "")
        supported = data.get("supported_source_schemas", [])
        if not isinstance(version, str) or not re.fullmatch(r"[0-9A-Za-z.+-]{1,100}", version):
            raise ValueError("Invalid application version")
        if not isinstance(schema, str) or not re.fullmatch(r"[a-z0-9_]{1,32}", schema):
            raise ValueError("Invalid schema revision")
        if not isinstance(supported, list) or not supported or len(supported) > 100:
            raise ValueError("Missing supported upgrade paths")
        if any(
            not isinstance(item, str) or not re.fullmatch(r"[a-z0-9_]{1,32}", item)
            for item in supported
        ):
            raise ValueError("Invalid supported schema revision")
        images = []
        for name in ("backend", "web"):
            value = data.get(f"{name}_image", "")
            prefix = f"ghcr.io/{repository}-{name}@sha256:"
            if (
                not isinstance(value, str)
                or not value.startswith(prefix)
                or not DIGEST.fullmatch(value[len(prefix) :])
            ):
                raise ValueError("Release images must be immutable images from this repository")
            images.append(value)
        checksum = data.get("bundle_sha256", "")
        if not isinstance(checksum, str) or not DIGEST.fullmatch(checksum):
            raise ValueError("Missing deployment checksum")
        return cls(
            repository, commit, sequence, version, schema, tuple(supported), *images, checksum
        )


@dataclass(frozen=True)
class Release:
    manifest: Manifest
    manifest_sha256: str
    bundle_url: str
    url: str
    notes: str
    published_at: str

    def summary(self) -> dict[str, Any]:
        return {
            "commit": self.manifest.commit,
            "sequence": self.manifest.sequence,
            "version": self.manifest.version,
            "manifest_sha256": self.manifest_sha256,
            "url": self.url,
            "notes": self.notes[:8000],
            "published_at": self.published_at,
        }


def extract_bundle(raw: bytes, release: Release, directory: Path) -> None:
    if hashlib.sha256(raw).hexdigest() != release.manifest.bundle_sha256:
        raise ValueError("The deployment bundle checksum does not match")
    with gzip.GzipFile(fileobj=io.BytesIO(raw)) as compressed:
        unpacked = compressed.read(3145729)
    if len(unpacked) > 3145728:
        raise ValueError("Deployment bundle exceeds its expanded size limit")
    with tarfile.open(fileobj=io.BytesIO(unpacked), mode="r:") as archive:
        members = archive.getmembers()
        if len(members) != len(BUNDLE_FILES) or {item.name for item in members} != BUNDLE_FILES:
            raise ValueError("Unexpected deployment bundle files")
        for member in members:
            if not member.isfile() or member.size > 1048576:
                raise ValueError("Unsafe deployment bundle member")
            file = archive.extractfile(member)
            if file is None:
                raise ValueError("Missing deployment file")
            write_file(directory / member.name, file.read(), 0o644)
