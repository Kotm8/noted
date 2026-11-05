from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai.models import AiRun
from app.ai.schemas import ConversationSummary
from app.core.errors import NotFoundError
from app.workspaces.services.channels import ChannelService


def conversations(db: Session, owner_id: UUID, channel_id: UUID) -> list[ConversationSummary]:
    ChannelService(db).get_channel(channel_id, owner_id)
    rows = db.scalars(
        select(AiRun)
        .where(
            AiRun.owner_id == owner_id,
            AiRun.channel_id == channel_id,
            AiRun.conversation_id.is_not(None),
        )
        .order_by(AiRun.created_at, AiRun.id)
    )
    grouped: dict[UUID, ConversationSummary] = {}
    for row in rows:
        conversation_id = row.conversation_id
        if conversation_id is None:
            continue
        if conversation_id not in grouped:
            grouped[conversation_id] = ConversationSummary(
                id=conversation_id,
                question=row.instructions,
                turns=0,
                updated_at=row.created_at,
            )
        grouped[conversation_id].turns += 1
        grouped[conversation_id].updated_at = row.created_at
    return sorted(grouped.values(), key=lambda item: item.updated_at, reverse=True)


def conversation(db: Session, owner_id: UUID, conversation_id: UUID) -> list[AiRun]:
    rows = list(
        db.scalars(
            select(AiRun)
            .where(
                AiRun.owner_id == owner_id,
                AiRun.conversation_id == conversation_id,
            )
            .order_by(AiRun.created_at, AiRun.id)
        )
    )
    if not rows:
        raise NotFoundError("Conversation not found")
    return rows
