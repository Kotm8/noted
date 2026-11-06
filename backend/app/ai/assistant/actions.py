import hashlib
from typing import Any
from uuid import UUID, uuid5

from sqlalchemy.orm import Session

from app.ai.assistant.chats import mark_applied
from app.ai.assistant.models import AssistantApplication, AssistantTurn
from app.ai.assistant.schemas import (
    AppliedDeletion,
    AppliedPost,
    AssistantActions,
    ItemDeletion,
    MessagePost,
)
from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.journals.service import JournalService
from app.notes.schemas import MessageCreate
from app.notes.services.messages import MessageService
from app.schedule.service import ScheduleService
from app.time_tracking.repository import TrackingRepository
from app.workspaces.models import Category, Workspace
from app.workspaces.services.channels import ChannelService


def destination(db: Session, owner: UUID, channel_id: UUID) -> dict[str, str]:
    channel = ChannelService(db).get_channel(channel_id, owner)
    project = db.get(Workspace, channel.workspace_id)
    if project is None or project.owner_id != owner:
        raise NotFoundError("Project not found")
    category = db.get(Category, channel.category_id) if channel.category_id else None
    return {
        "channel_id": str(channel.id),
        "channel_name": channel.name,
        "workspace_id": str(project.id),
        "workspace_name": project.name,
        "category_name": category.name if category else "",
        "kind": channel.kind,
        "url": f"/w/{project.id}/c/{channel.id}",
    }


def deletion_preview(db: Session, owner: UUID, change: ItemDeletion) -> dict[str, Any]:
    if change.kind == "plan":
        plan = ScheduleService(db).repository.plan(owner, change.id)
        return {
            "title": plan.title,
            "revision": plan.revision,
            "frequency": plan.frequency,
            "date": plan.date.isoformat(),
            "start_minute": plan.start_minute,
            "end_minute": plan.end_minute,
            "timezone": plan.timezone,
        }
    if change.kind == "journal":
        entry = JournalService(db).get(change.id, owner)
        return {
            **destination(db, owner, entry.channel_id),
            "title": entry.title,
            "preview": entry.content,
            "revision": entry.revision,
        }
    message = MessageService(db).get_message(change.id, owner)
    target = destination(db, owner, message.channel_id)
    if target["kind"] in {"document", "journal"}:
        raise ValidationError("Choose a message or a journal entry, not a Notes document")
    return {
        **target,
        "title": message.content.splitlines()[0][:100]
        if message.content.strip()
        else "Attachment message",
        "preview": message.content,
    }


def review_actions(db: Session, owner: UUID, output: dict[str, Any]) -> dict[str, Any]:
    posts = []
    for raw in output.get("posts") or []:
        post = MessagePost.model_validate(raw)
        target = destination(db, owner, post.channel_id)
        if target["kind"] not in {"note", "tasks"}:
            raise ValidationError("Post messages to a chat or Tasks channel")
        posts.append({**post.model_dump(mode="json"), "destination": target})
    deletions = []
    for raw in output.get("deletions") or []:
        change = ItemDeletion.model_validate(raw)
        preview = deletion_preview(db, owner, change)
        deletions.append(
            {
                **change.model_dump(mode="json"),
                "revision": preview.get("revision"),
                "target": preview,
            }
        )
    return {**output, "posts": posts, "deletions": deletions}


def apply_actions(db: Session, owner: UUID, data: AssistantActions) -> dict[str, Any]:
    if data.deletions and not data.confirmed:
        raise ValidationError("Confirm the listed deletions before applying")
    changes: list[AppliedPost | AppliedDeletion] = [*data.posts, *data.deletions]
    keys = [item.key for item in changes]
    if len(keys) != len(set(keys)):
        raise ValidationError("Review each action only once")
    results = []
    for change in changes:
        key = change.key
        request_id = uuid5(data.request_id, key)
        fingerprint = hashlib.sha256(change.model_dump_json().encode()).hexdigest()
        try:
            TrackingRepository(db).lock(owner)
            previous = db.get(AssistantApplication, request_id)
            if previous:
                if previous.owner_id != owner or previous.fingerprint != fingerprint:
                    raise ConflictError("This action was already applied differently")
                results.append(previous.result)
                db.commit()
                continue
            result: dict[str, Any] = {"key": key, "ok": True}
            if isinstance(change, MessagePost):
                target = destination(db, owner, change.channel_id)
                if target["kind"] not in {"note", "tasks"}:
                    raise ValidationError("Choose a chat or Tasks channel")
                message = MessageService(db).create_message(
                    change.channel_id,
                    MessageCreate(content=change.text, client_id=request_id),
                    owner,
                    commit=False,
                )
                message.ai_generated = True
                result.update(
                    message_id=str(message.id),
                    url=f"{target['url']}?note={message.id}",
                    destination=target,
                )
            else:
                deletion_preview(db, owner, change)
                if change.kind == "plan":
                    service = ScheduleService(db)
                    plan = service.repository.plan(owner, change.id)
                    if plan.frequency != "none" and (
                        change.scope is None
                        or (change.scope == "occurrence" and change.occurrence_date is None)
                    ):
                        raise ValidationError("Choose this occurrence or the entire series")
                    if change.revision is None:
                        raise ValidationError("Reload the plan before deleting")
                    service.remove(
                        owner,
                        change.id,
                        change.revision,
                        change.occurrence_date if change.scope == "occurrence" else None,
                        commit=False,
                    )
                elif change.kind == "journal":
                    if change.revision is None:
                        raise ValidationError("Reload the entry before deleting")
                    JournalService(db).remove(change.id, owner, change.revision, commit=False)
                else:
                    MessageService(db).delete_message(change.id, owner, commit=False)
            db.add(
                AssistantApplication(
                    id=request_id, owner_id=owner, fingerprint=fingerprint, result=result
                )
            )
            db.commit()
            results.append(result)
        except (NotFoundError, ValidationError, ConflictError) as error:
            db.rollback()
            results.append({"key": key, "ok": False, "error": str(error)})
    if results and all(item["ok"] for item in results):
        mark_applied(db, owner, data.turn_id)
    turn = db.get(AssistantTurn, data.turn_id) if data.turn_id else None
    if turn and turn.owner_id == owner:
        turn.proposal = {**(turn.proposal or {}), "action_results": results}
    db.commit()
    return {"results": results}
