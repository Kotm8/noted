import asyncio
import hashlib
import os
import shutil
import tempfile
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select

from app.auth.models import User
from app.backup.services.archive import validate_archive
from app.backup.services.exporter import BackupExporter
from app.backup.services.importer import BackupImporter
from app.notes.models import Attachment, Message
from app.storage.local import LocalFileStorage


@pytest.mark.skipif(
    os.environ.get("NOTED_LARGE_BACKUP_TEST") != "1", reason="Opt-in multi-GiB backup verification"
)
def test_real_multigib_export_validate_and_restore(owner, channel, db, tmp_path):
    if shutil.disk_usage(tmp_path).free < 11 * 1024**3:
        pytest.skip("The large backup fixture needs 11 GiB free space")
    user = db.scalar(select(User))
    with tempfile.TemporaryDirectory(prefix="large-backup-", dir=tmp_path) as temporary:
        directory = Path(temporary)
        storage = LocalFileStorage(directory / "storage")
        sample = directory / "sample.bin"
        block = bytes(range(256)) * 4096
        with sample.open("wb") as output:
            for _ in range(225):
                output.write(block)
        with sample.open("rb") as source:
            digest = hashlib.file_digest(source, "sha256").hexdigest()
        for index in range(5):
            message = Message(
                channel_id=UUID(channel["id"]), author_id=user.id, content=f"Large backup {index}"
            )
            db.add(message)
            db.flush()
            for position in range(2):
                identifier = uuid4().hex
                key = f"{identifier[:2]}/{identifier}"
                destination = storage.directory / key
                destination.parent.mkdir(exist_ok=True)
                shutil.copyfile(sample, destination)
                db.add(
                    Attachment(
                        message_id=message.id,
                        original_filename="sample.bin",
                        storage_key=key,
                        content_type="application/octet-stream",
                        size=sample.stat().st_size,
                        position=position,
                    )
                )
        db.commit()
        archive = directory / "backup.zip"
        asyncio.run(BackupExporter(db, storage).create(user.id, archive))
        assert archive.stat().st_size > 2 * 1024**3
        staged = directory / "staged"
        data = validate_archive(archive, staged)
        assert len(data.attachments) == 10
        asyncio.run(BackupImporter(db, storage).restore(data, staged, user.id, False))
        attachments = list(db.scalars(select(Attachment)))
        assert len(attachments) == 20
        for attachment in attachments:
            with (storage.directory / attachment.storage_key).open("rb") as source:
                assert hashlib.file_digest(source, "sha256").hexdigest() == digest
