from typing import Any
from uuid import UUID

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.core.errors import ContentTooLargeError
from app.journals.models import JournalEntry
from app.notes.documents.models import ChannelDocument
from app.notes.models import Attachment, Message
from app.publishing.models import ScheduledMessage, WritingPrompt
from app.reminders.models import Reminder
from app.schedule.models import ScheduleException, SchedulePlan
from app.schedule.prompts.models import PlanPromptEvent
from app.time_tracking.models import Activity, TimeSession
from app.workspaces.models import Category, Channel, Workspace

MAX_RECORDS = 50000


class BackupRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def content(self, owner_id: UUID) -> dict[str, list[dict[str, Any]]]:
        projects = select(Workspace.id).where(Workspace.owner_id == owner_id)
        channels = select(Channel.id).where(Channel.workspace_id.in_(projects))
        messages = select(Message.id).where(
            Message.channel_id.in_(channels), Message.deleted_at.is_(None)
        )
        text_size = (
            self.db.scalar(
                select(func.sum(func.octet_length(Message.content))).where(Message.id.in_(messages))
            )
            or 0
        )
        text_size += (
            self.db.scalar(
                select(
                    func.sum(
                        func.octet_length(JournalEntry.content)
                        + func.octet_length(JournalEntry.title)
                    )
                ).where(JournalEntry.channel_id.in_(channels))
            )
            or 0
        )
        text_size += (
            self.db.scalar(
                select(func.sum(func.octet_length(ChannelDocument.content))).where(
                    ChannelDocument.channel_id.in_(channels)
                )
            )
            or 0
        )
        for model in (ScheduledMessage, WritingPrompt):
            text_size += (
                self.db.scalar(
                    select(func.sum(func.octet_length(model.content))).where(
                        model.channel_id.in_(channels)
                    )
                )
                or 0
            )
        if text_size > 16 * 1024 * 1024:
            raise ContentTooLargeError("The message text exceeds the 16 MB content backup limit.")
        plans = select(SchedulePlan.id).where(
            SchedulePlan.owner_id == owner_id, SchedulePlan.deleted_at.is_(None)
        )
        queries = {
            "scheduled_messages": select(ScheduledMessage.__table__).where(
                ScheduledMessage.channel_id.in_(channels)
            ),
            "writing_prompts": select(WritingPrompt.__table__).where(
                WritingPrompt.channel_id.in_(channels)
            ),
            "activities": select(Activity.__table__).where(Activity.owner_id == owner_id),
            "time_sessions": select(TimeSession.__table__).where(TimeSession.owner_id == owner_id),
            "schedule_plans": select(SchedulePlan.__table__).where(SchedulePlan.id.in_(plans)),
            "plan_events": select(PlanPromptEvent.__table__).where(
                PlanPromptEvent.plan_id.in_(plans)
            ),
            "schedule_exceptions": select(ScheduleException.__table__).where(
                ScheduleException.plan_id.in_(plans)
            ),
            "workspaces": select(Workspace.__table__).where(Workspace.id.in_(projects)),
            "categories": select(Category.__table__).where(Category.workspace_id.in_(projects)),
            "channels": select(Channel.__table__).where(Channel.id.in_(channels)),
            "messages": select(Message.__table__).where(Message.id.in_(messages)),
            "attachments": select(Attachment.__table__).where(Attachment.message_id.in_(messages)),
            "reminders": select(Reminder.__table__).where(Reminder.message_id.in_(messages)),
            "journals": select(JournalEntry.__table__).where(JournalEntry.channel_id.in_(channels)),
            "documents": select(ChannelDocument.__table__).where(
                ChannelDocument.channel_id.in_(channels)
            ),
        }
        result: dict[str, list[dict[str, Any]]] = {}
        total = 0
        for name, query in queries.items():
            rows = self.db.execute(query.limit(MAX_RECORDS + 1)).mappings().all()
            total += len(rows)
            if total > MAX_RECORDS:
                raise ContentTooLargeError("This content backup exceeds the 50,000 record limit.")
            result[name] = [dict(row) for row in rows]
        return result

    def clear(self, owner_id: UUID) -> None:
        self.db.execute(delete(Workspace).where(Workspace.owner_id == owner_id))
