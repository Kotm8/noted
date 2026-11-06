"""Messages attached to an assistant request, numbered the way the model refers to them."""

from dataclasses import dataclass, field
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from app.ai.assistant.schemas import AssistantContext
from app.ai.knowledge.schemas import IMAGE_TYPES, MAX_IMAGES, AttachedImage
from app.ai.prompts import PromptService
from app.core.errors import NotFoundError, ValidationError
from app.notes.mentions import readable
from app.notes.models import Message
from app.workspaces.services.channels import ChannelService

INSTRUCTIONS = (
    "The owner attached numbered messages from #{channel}. Work on them when the request is "
    "about them. To edit them, return rewrites with each changed message's number and complete "
    "new text, keeping its Markdown; leave out messages that don't change. They're applied only "
    "after the owner reviews them. When the owner asks for a reply{thread}, return it in reply; "
    "it's posted in the thread right away, so write it as the finished reply, without preamble. "
    "When they want a message to send themselves, return it in draft. Otherwise just answer in "
    "the explanation. Keep the explanation short when you return a rewrite, reply or draft."
    " Requests to post to a different channel use posts and require review, independently of "
    "these attachments. Do not also return a thread reply for that request."
)


@dataclass
class Attached:
    channel_id: UUID
    channel_name: str
    reply_to: UUID
    numbered: dict[int, UUID] = field(default_factory=dict)
    items: list[dict[str, Any]] = field(default_factory=list)
    images: list[AttachedImage] = field(default_factory=list)
    prompt_name: str | None = None
    prompt_instructions: str | None = None
    prompt_kind: str | None = None

    def instructions(self, in_thread: bool) -> str:
        return INSTRUCTIONS.format(
            channel=self.channel_name,
            thread=" or is asking from inside a thread" if in_thread else "",
        )


def attach(db: Session, owner_id: UUID, context: AssistantContext) -> Attached:
    channel = ChannelService(db).get_channel(context.channel_id, owner_id)
    if len(set(context.message_ids)) != len(context.message_ids):
        raise ValidationError("Attach each message once.")
    attached: Attached | None = None
    for number, message_id in enumerate(context.message_ids, start=1):
        message = db.get(Message, message_id)
        if message is None or message.deleted_at is not None:
            raise NotFoundError("An attached message no longer exists.")
        if message.channel_id != channel.id:
            raise ValidationError("Attach messages from one channel.")
        if attached is None:
            root = context.thread_root_id or message.thread_root_id or message.id
            attached = Attached(channel_id=channel.id, channel_name=channel.name, reply_to=root)
        attached.numbered[number] = message.id
        attached.items.append({"number": number, "text": readable(message.content)})
        attached.images.extend(
            AttachedImage(id=file.id, name=file.original_filename, message_number=number)
            for file in message.attachments
            if file.content_type in IMAGE_TYPES
        )
    assert attached is not None
    if context.thread_root_id is not None:
        thread = db.get(Message, context.thread_root_id)
        if thread is None or thread.channel_id != channel.id or thread.thread_root_id is not None:
            raise NotFoundError("This thread no longer exists.")
    if len(attached.images) > MAX_IMAGES:
        raise ValidationError("Attach messages with at most eight pictures at a time.")
    if context.prompt_id:
        saved = PromptService(db).get(owner_id, context.prompt_id)
        attached.prompt_name = saved.name
        attached.prompt_instructions = saved.instructions
        attached.prompt_kind = saved.kind
    return attached
