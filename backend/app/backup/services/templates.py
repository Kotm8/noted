from uuid import UUID

from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.backup.schemas import BackupContent
from app.backup.services.tracking import remap_nudge
from app.core.errors import ValidationError
from app.live import mark
from app.templates.models import DayTemplate, NoteTemplate, TemplateApplication
from app.templates.repository import TemplateRepository


def validate_templates(data: BackupContent) -> None:
    if (data.day_templates or data.note_templates) and data.version < 9:
        raise ValidationError("Templates require a version 9 backup")
    if max(len(data.day_templates), len(data.note_templates)) > 100:
        raise ValidationError("Keep up to 100 templates of each kind")
    activities = {item.id for item in data.activities}
    channels = {item.id for item in data.channels}
    for template in data.day_templates:
        for block in template.blocks:
            if block.activity_id not in activities:
                raise ValidationError("A day template references an unknown activity")
            if (
                block.writing_nudge
                and block.writing_nudge.channel_id
                and block.writing_nudge.channel_id not in channels
            ):
                raise ValidationError("A template writing nudge references an unknown channel")


def restore_templates(
    db: Session, owner_id: UUID, data: BackupContent, ids: dict[UUID, UUID], replace: bool
) -> None:
    repository = TemplateRepository(db)
    if replace:
        for model in (DayTemplate, NoteTemplate, TemplateApplication):
            db.execute(delete(model).where(model.owner_id == owner_id))
        mark(db, "templates", user=owner_id)
    groups: list[tuple[type[DayTemplate] | type[NoteTemplate], int]] = [
        (DayTemplate, len(data.day_templates)),
        (NoteTemplate, len(data.note_templates)),
    ]
    for model, count in groups:
        if len(repository.list(model, owner_id)) + count > 100:
            raise ValidationError("Import exceeds the template limit. Use Replace instead.")
    for note in data.note_templates:
        db.add(
            NoteTemplate(
                id=ids[note.id],
                owner_id=owner_id,
                name=note.name,
                content=note.content,
                revision=note.revision,
            )
        )
    for day in data.day_templates:
        blocks = []
        for block in day.blocks:
            blocks.append(
                block.model_dump(mode="json")
                | {
                    "activity_id": str(ids[block.activity_id]),
                    "writing_nudge": remap_nudge(block.writing_nudge, ids),
                }
            )
        db.add(
            DayTemplate(
                id=ids[day.id],
                owner_id=owner_id,
                name=day.name,
                blocks=blocks,
                revision=day.revision,
            )
        )
