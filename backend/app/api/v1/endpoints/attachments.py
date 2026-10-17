from datetime import UTC
from email.utils import format_datetime, parsedate_to_datetime
from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response, StreamingResponse
from pydantic import ValidationError as SchemaError
from sqlalchemy.orm import Session
from starlette.datastructures import UploadFile

from app.auth.services.sessions import AuthenticatedSession
from app.core.errors import NotFoundError, ValidationError
from app.core.storage_limits import MAX_FILES
from app.dependencies.auth import get_current_session
from app.dependencies.database import get_db
from app.dependencies.storage import get_storage
from app.notes.models import Message
from app.notes.ranges import UnsatisfiableRange, parse_byte_range
from app.notes.schemas import MessageResponse
from app.notes.services.attachments import AttachmentService
from app.notes.services.playback import PlaybackService
from app.reminders.schemas import ReminderSchedule
from app.storage.base import FileStorage

router = APIRouter(tags=["attachments"])


@router.post(
    "/channels/{channel_id}/messages/with-files", response_model=MessageResponse, status_code=201
)
async def upload_message(
    channel_id: UUID,
    request: Request,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
    storage: FileStorage = Depends(get_storage),
) -> Message:
    async with request.form(max_files=MAX_FILES, max_fields=2, max_part_size=160000) as form:
        content = form.get("content", "")
        files = form.getlist("files")
        raw_reminder = form.get("reminder")
        try:
            reminder = (
                ReminderSchedule.model_validate_json(raw_reminder)
                if isinstance(raw_reminder, str)
                else None
            )
        except SchemaError:
            raise ValidationError("Choose a valid reminder time.") from None
        if not isinstance(content, str) or not all(isinstance(file, UploadFile) for file in files):
            raise ValidationError("Send a text caption and one or more files.")
        return await AttachmentService(db, storage).create_message(
            channel_id,
            current.user.id,
            content,
            [file for file in files if isinstance(file, UploadFile)],
            reminder,
        )


@router.get("/attachments/{attachment_id}/download")
async def download_attachment(
    attachment_id: UUID,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
    storage: FileStorage = Depends(get_storage),
) -> StreamingResponse:
    attachment = await AttachmentService(db, storage).get_attachment(attachment_id, current.user.id)
    filename = quote(attachment.original_filename, safe="")
    return StreamingResponse(
        storage.read(attachment.storage_key),
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{filename}",
            "Content-Length": str(attachment.size),
        },
    )


@router.get("/attachments/{attachment_id}/preview")
async def preview_attachment(
    attachment_id: UUID,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
    storage: FileStorage = Depends(get_storage),
) -> StreamingResponse:
    attachment = await AttachmentService(db, storage).get_attachment(attachment_id, current.user.id)
    if attachment.content_type not in {"image/png", "image/jpeg", "image/gif", "image/webp"}:
        raise NotFoundError("This file has no image preview")
    return StreamingResponse(
        storage.read(attachment.storage_key),
        media_type=attachment.content_type,
        headers={"Content-Length": str(attachment.size)},
    )


@router.api_route("/attachments/{attachment_id}/playback", methods=["GET", "HEAD"])
async def play_attachment(
    attachment_id: UUID,
    request: Request,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
    storage: FileStorage = Depends(get_storage),
) -> Response:
    playable = await PlaybackService(db, storage).get(attachment_id, current.user.id)
    attachment = playable.attachment
    modified = attachment.created_at.astimezone(UTC).replace(microsecond=0)
    etag = f'"{attachment.id.hex}"'
    filename = quote(attachment.original_filename, safe="")
    headers = {
        "Accept-Ranges": "bytes",
        "Content-Length": str(attachment.size),
        "Content-Disposition": f"inline; filename*=UTF-8''{filename}",
        "ETag": etag,
        "Last-Modified": format_datetime(modified, usegmt=True),
    }
    if request.method == "HEAD":
        return Response(media_type=playable.content_type, headers=headers)
    range_header = request.headers.get("range")
    if_range = request.headers.get("if-range")
    if if_range and if_range != etag:
        try:
            if parsedate_to_datetime(if_range) != modified:
                range_header = None
        except (ValueError, TypeError):
            range_header = None
    try:
        requested = parse_byte_range(range_header, attachment.size)
    except UnsatisfiableRange:
        headers["Content-Range"] = f"bytes */{attachment.size}"
        headers["Content-Length"] = "0"
        return Response(status_code=416, headers=headers)
    start, end = (requested.start, requested.end + 1) if requested else (0, attachment.size)
    if requested:
        headers["Content-Length"] = str(requested.length)
        headers["Content-Range"] = f"bytes {requested.start}-{requested.end}/{attachment.size}"
    return StreamingResponse(
        storage.read(attachment.storage_key, start, end),
        status_code=206 if requested else 200,
        media_type=playable.content_type,
        headers=headers,
    )
