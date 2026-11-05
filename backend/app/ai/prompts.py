from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.ai.models import AiPrompt
from app.ai.schemas import AiPreferences, PromptInput, PromptUpdate
from app.auth.models import User
from app.core.errors import ConflictError, NotFoundError, ValidationError

LIMIT = 50
ALL = ["messages", "journals", "documents", "composer"]
STARTERS = [
    ("Fix spelling", "Fix spelling and grammar. Keep my wording and tone.", "rewrite", ALL),
    ("Make shorter", "Make it shorter without losing anything important.", "rewrite", ALL),
    (
        "Turn into tasks",
        "Turn each message into a checklist item, like `- [ ] Buy milk`.",
        "rewrite",
        ["messages"],
    ),
    (
        "Summarise",
        "Summarise this in two or three sentences.",
        "answer",
        ["messages", "journals", "documents"],
    ),
    ("Translate to Russian", "Translate to Russian, keeping the formatting.", "rewrite", ALL),
    ("Ideas for this", "Reply with three ideas that build on this.", "reply", ["messages"]),
    ("Write a message", "Write a short message I could send about this.", "draft", ["messages"]),
]


WRITING_STARTERS = [
    (
        "Weekly review",
        "Review these entries: what went well, what was difficult, "
        "and what should I carry forward?",
        "answer",
        ["journals"],
    ),
    (
        "What patterns do you see?",
        "Identify recurring themes and patterns across these entries. "
        "Be specific and grounded in my writing.",
        "answer",
        ["journals"],
    ),
    (
        "Three questions to write about",
        "Suggest three thoughtful questions to help me start writing this entry. "
        "Use its title if available.",
        "answer",
        ["journals", "documents"],
    ),
    (
        "Outline from a title",
        "Make a concise Markdown outline from this entry's title. Leave room for me to write.",
        "answer",
        ["journals", "documents"],
    ),
]


def preferences(user: User) -> AiPreferences:
    return AiPreferences.model_validate(user.ai_preferences or {})


class PromptService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def all(self, owner_id: UUID) -> list[AiPrompt]:
        user = self.db.scalar(select(User).where(User.id == owner_id).with_for_update())
        prompts = list(
            self.db.scalars(
                select(AiPrompt)
                .where(AiPrompt.owner_id == owner_id)
                .order_by(AiPrompt.position, AiPrompt.id)
            )
        )
        if user is None:
            return prompts
        markers = dict(user.ai_preferences or {})
        additions = []
        if not markers.get("starters_added"):
            if not prompts:
                additions.extend(STARTERS)
            markers["starters_added"] = True
        if not markers.get("starters_v2"):
            additions.extend(WRITING_STARTERS)
            markers["starters_v2"] = True
        position = max((prompt.position for prompt in prompts), default=-1) + 1
        for offset, (name, instructions, kind, places) in enumerate(additions):
            if len(prompts) >= LIMIT:
                break
            prompt = AiPrompt(
                owner_id=owner_id,
                name=name,
                instructions=instructions,
                kind=kind,
                places=places,
                position=position + offset,
            )
            self.db.add(prompt)
            prompts.append(prompt)
        user.ai_preferences = markers
        self.db.commit()
        return prompts

    def get(self, owner_id: UUID, prompt_id: UUID) -> AiPrompt:
        prompt = self.db.get(AiPrompt, prompt_id)
        if prompt is None or prompt.owner_id != owner_id:
            raise NotFoundError("Saved prompt not found")
        return prompt

    def create(self, owner_id: UUID, data: PromptInput) -> AiPrompt:
        count = self.db.scalar(
            select(func.count()).select_from(AiPrompt).where(AiPrompt.owner_id == owner_id)
        )
        if (count or 0) >= LIMIT:
            raise ValidationError(f"Keep up to {LIMIT} saved prompts.")
        position = self.db.scalar(
            select(func.coalesce(func.max(AiPrompt.position), -1) + 1).where(
                AiPrompt.owner_id == owner_id
            )
        )
        prompt = AiPrompt(owner_id=owner_id, position=position or 0, **data.model_dump())
        self.db.add(prompt)
        self.db.commit()
        self.db.refresh(prompt)
        return prompt

    def update(self, owner_id: UUID, prompt_id: UUID, data: PromptUpdate) -> AiPrompt:
        prompt = self.get(owner_id, prompt_id)
        if prompt.revision != data.revision:
            raise ConflictError("This prompt changed on another device. Reload it first.")
        for key, value in data.model_dump(exclude={"revision"}).items():
            setattr(prompt, key, value)
        prompt.revision += 1
        self.db.commit()
        self.db.refresh(prompt)
        return prompt

    def delete(self, owner_id: UUID, prompt_id: UUID) -> None:
        self.db.delete(self.get(owner_id, prompt_id))
        self.db.commit()

    def reorder(self, owner_id: UUID, ids: list[UUID]) -> list[AiPrompt]:
        prompts = {prompt.id: prompt for prompt in self.all(owner_id)}
        if set(ids) != set(prompts):
            raise ConflictError("Your prompts changed. Reload them before reordering.")
        for position, prompt_id in enumerate(ids):
            prompts[prompt_id].position = position
        self.db.commit()
        return self.all(owner_id)
