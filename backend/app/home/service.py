from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import ConflictError, NotFoundError
from app.core.security import utc_now
from app.home.schemas import HomeActivity, HomeActivityPage, ReadActivities
from app.notes.mentions import readable
from app.notes.models import Message
from app.publishing.models import WritingPrompt
from app.reminders.models import Reminder
from app.schedule.prompts.models import PlanPrompt
from app.schedule.prompts.service import refresh_prompts
from app.workspaces.models import Channel, Workspace


class HomeService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def activity(self, owner_id: UUID, limit: int) -> HomeActivityPage:
        refresh_prompts(self.db, owner_id)
        now = utc_now()
        reminders = self.db.execute(
            select(
                Reminder,
                func.left(Message.content, 500),
                Channel.id,
                Channel.name,
                Workspace.id,
                Workspace.name,
            )
            .join(Message, Message.id == Reminder.message_id)
            .join(Channel, Channel.id == Message.channel_id)
            .join(Workspace, Workspace.id == Channel.workspace_id)
            .where(
                Workspace.owner_id == owner_id,
                Message.deleted_at.is_(None),
                Reminder.status == "active",
                Reminder.due_at <= now,
            )
            .order_by(Reminder.due_at.desc(), Reminder.message_id)
            .limit(limit + 1)
        ).all()
        items = [
            HomeActivity(
                kind="reminder",
                id=reminder.message_id,
                revision=reminder.revision,
                title=readable(content) or "Attachment reminder",
                due_at=reminder.due_at,
                read=reminder.read_revision == reminder.revision,
                channel_id=channel_id,
                channel_name=channel_name,
                workspace_id=workspace_id,
                workspace_name=workspace_name,
            )
            for (
                reminder,
                content,
                channel_id,
                channel_name,
                workspace_id,
                workspace_name,
            ) in reminders
        ]
        prompts = self.db.scalars(
            select(PlanPrompt)
            .where(
                PlanPrompt.owner_id == owner_id,
                PlanPrompt.status == "pending",
                PlanPrompt.notify_at <= now,
            )
            .order_by(PlanPrompt.notify_at.desc(), PlanPrompt.id)
            .limit(limit + 1)
        )
        items.extend(
            HomeActivity(
                kind="plan",
                id=item.id,
                revision=item.revision,
                title=f"Ended: {item.title}" if item.phase == "end" else item.title,
                due_at=item.notify_at,
                read=item.read_revision == item.revision,
            )
            for item in prompts
        )
        writing = self.db.execute(
            select(WritingPrompt, Channel, Workspace)
            .join(Channel, Channel.id == WritingPrompt.channel_id)
            .join(Workspace, Workspace.id == Channel.workspace_id)
            .where(
                WritingPrompt.owner_id == owner_id,
                WritingPrompt.enabled.is_(True),
                WritingPrompt.due_at <= now,
            )
            .order_by(WritingPrompt.due_at.desc(), WritingPrompt.id)
            .limit(limit + 1)
        ).all()
        items.extend(
            HomeActivity(
                kind="writing",
                id=prompt.id,
                revision=prompt.revision,
                title=prompt.content,
                due_at=prompt.due_at,
                read=prompt.read_revision == prompt.revision,
                channel_id=channel.id,
                channel_name=channel.name,
                workspace_id=project.id,
                workspace_name=project.name,
            )
            for prompt, channel, project in writing
        )
        items.sort(key=lambda item: (item.due_at, str(item.id)), reverse=True)
        self.db.commit()
        return HomeActivityPage(items=items[:limit], has_more=len(items) > limit)

    def read(self, owner_id: UUID, data: ReadActivities) -> None:
        record: Reminder | PlanPrompt | WritingPrompt | None
        for item in sorted(data.items, key=lambda item: (item.kind, str(item.id))):
            if item.kind == "reminder":
                record = self.db.scalar(
                    select(Reminder)
                    .join(Message)
                    .join(Channel, Channel.id == Message.channel_id)
                    .join(Workspace, Workspace.id == Channel.workspace_id)
                    .where(
                        Reminder.message_id == item.id,
                        Workspace.owner_id == owner_id,
                        Message.deleted_at.is_(None),
                    )
                    .with_for_update(of=Reminder)
                )
            elif item.kind == "writing":
                record = self.db.scalar(
                    select(WritingPrompt)
                    .where(WritingPrompt.id == item.id, WritingPrompt.owner_id == owner_id)
                    .with_for_update()
                )
            else:
                record = self.db.scalar(
                    select(PlanPrompt)
                    .where(PlanPrompt.id == item.id, PlanPrompt.owner_id == owner_id)
                    .with_for_update()
                )
            if record is None:
                raise NotFoundError("This notification is no longer available")
            if record.revision != item.revision:
                raise ConflictError(
                    "This notification changed. Refresh Home before marking it read."
                )
            record.read_revision = record.revision
        self.db.commit()
