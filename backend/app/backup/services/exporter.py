import hashlib
import json
import zipfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.backup.repository import BackupRepository
from app.backup.schemas import BackupContent
from app.backup.services.archive import MAX_METADATA
from app.backup.services.tracking import tracking_document
from app.core.errors import ConflictError, ContentTooLargeError
from app.core.storage_limits import MAX_ARCHIVE
from app.storage.base import FileStorage


class BackupExporter:
    def __init__(self, db: Session, storage: FileStorage) -> None:
        self.db = db
        self.storage = storage

    async def create(self, owner_id: UUID, destination: Path) -> BackupContent:
        with Session(self.db.get_bind()) as snapshot:
            snapshot.execute(text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY"))
            rows = BackupRepository(snapshot).content(owner_id)
        document: dict[str, Any] = {
            "format": "noted-content-backup",
            "version": 1,
            "created_at": datetime.now(UTC).isoformat(),
            "workspaces": [],
            "categories": [],
            "channels": [],
            "messages": [],
            "attachments": [],
        }
        with zipfile.ZipFile(destination, "w", allowZip64=False) as archive:
            for row in rows["workspaces"]:
                image = None
                if row["icon_storage_key"]:
                    image = await self.add_file(
                        archive, row["icon_storage_key"], row["icon_size"], destination
                    )
                document["workspaces"].append(
                    {key: row[key] for key in ("id", "name", "icon", "position", "created_at")}
                    | {"image": image, "image_type": row["icon_content_type"]}
                )
            for row in rows["channels"]:
                image = None
                if row["banner_storage_key"]:
                    image = await self.add_file(
                        archive, row["banner_storage_key"], row["banner_size"], destination
                    )
                record = {
                    key: row[key]
                    for key in (
                        "id",
                        "workspace_id",
                        "category_id",
                        "name",
                        "position",
                        "created_at",
                        "kind",
                    )
                }
                if image:
                    record.update(image=image, image_type=row["banner_content_type"])
                document["channels"].append(record)
            for name, fields in (
                ("categories", ("id", "workspace_id", "name", "position")),
                ("messages", ("id", "channel_id", "content", "created_at", "updated_at")),
            ):
                document[name] = [{key: row[key] for key in fields} for row in rows[name]]
            reminders = {
                row["message_id"]: {
                    key: row[key]
                    for key in ("due_at", "scheduled_at", "timezone", "repeat", "status")
                }
                for row in rows["reminders"]
            }
            for message in document["messages"]:
                if message["id"] in reminders:
                    message["reminder"] = reminders[message["id"]]
            roots = {
                row["id"]: row["thread_root_id"]
                for row in rows["messages"]
                if row["thread_root_id"]
            }
            for message in document["messages"]:
                if message["id"] in roots:
                    message["thread_root_id"] = roots[message["id"]]
            if rows["journals"]:
                document["journals"] = [
                    {
                        key: row[key]
                        for key in (
                            "id",
                            "channel_id",
                            "title",
                            "content",
                            "revision",
                            "created_at",
                            "updated_at",
                        )
                    }
                    for row in rows["journals"]
                ]
            if (
                roots
                or rows["journals"]
                or any(row["kind"] == "journal" for row in rows["channels"])
            ):
                document["version"] = 2
            for row in rows["attachments"]:
                blob = await self.add_file(archive, row["storage_key"], row["size"], destination)
                document["attachments"].append(
                    {
                        key: row[key]
                        for key in ("id", "message_id", "content_type", "position", "created_at")
                    }
                    | {"filename": row["original_filename"], "file": blob}
                )
            tracking = tracking_document(rows, datetime.now(UTC).isoformat())
            if any(tracking.values()):
                version = 4 if tracking["schedule_plans"] or tracking["plan_events"] else 3
                if version == 3:
                    tracking.pop("plan_events")
                document.update(tracking)
                document["version"] = version
            if rows["documents"] or any(row["kind"] == "document" for row in rows["channels"]):
                document["version"] = 5
                document["documents"] = [
                    {
                        key: row[key]
                        for key in ("channel_id", "content", "revision", "created_at", "updated_at")
                    }
                    for row in rows["documents"]
                ]
            if rows["scheduled_messages"] or rows["writing_prompts"]:
                document["version"] = 6
                for name, publishing_fields in (
                    (
                        "scheduled_messages",
                        (
                            "id",
                            "channel_id",
                            "content",
                            "send_at",
                            "timezone",
                            "status",
                            "revision",
                            "created_at",
                        ),
                    ),
                    (
                        "writing_prompts",
                        (
                            "id",
                            "channel_id",
                            "content",
                            "start_at",
                            "timezone",
                            "frequency",
                            "weekdays",
                            "enabled",
                        ),
                    ),
                ):
                    document[name] = [
                        {key: row[key] for key in publishing_fields} for row in rows[name]
                    ]
            if any(row["kind"] == "tasks" for row in rows["channels"]):
                document["version"] = 7
            raw = json.dumps(document, default=str, ensure_ascii=False).encode()
            if len(raw) > MAX_METADATA:
                raise ContentTooLargeError("The content metadata exceeds the 16 MB backup limit.")
            archive.writestr(
                "content.json", raw, compress_type=zipfile.ZIP_DEFLATED, compresslevel=3
            )
        if destination.stat().st_size > MAX_ARCHIVE:
            raise ContentTooLargeError("This backup exceeds the 1 GB ZIP limit.")
        return BackupContent.model_validate_json(raw)

    async def add_file(
        self, archive: zipfile.ZipFile, key: str, expected: int, path: Path
    ) -> dict[str, Any]:
        digest = hashlib.sha256()
        name = f"files/{uuid4().hex}"
        size = 0
        try:
            with archive.open(name, "w") as destination:
                async for chunk in self.storage.read(key):
                    size += len(chunk)
                    if size > expected or path.stat().st_size + len(chunk) > MAX_ARCHIVE:
                        raise ContentTooLargeError(
                            "This backup exceeds its file or archive limits."
                        )
                    digest.update(chunk)
                    destination.write(chunk)
        except FileNotFoundError:
            raise ConflictError("A file changed during backup. Try exporting again.") from None
        if size != expected:
            raise ConflictError("An attachment is incomplete. The backup was not generated.")
        return {"path": name, "size": size, "sha256": digest.hexdigest()}
