from datetime import date, datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator

from app.backup.preferences import BackupPreferences
from app.core.storage_limits import MAX_FILE_SIZE, MAX_ICON_SIZE
from app.finance.schemas import AccountFields, EntryFields
from app.finance.schemas import ProfileFields as FinanceProfileFields
from app.habits.schemas import HabitFields
from app.notes.documents.reminders.schemas import DocumentReminderCreate
from app.nutrition.schemas import MealItem, ProfileFields, Slot, Source
from app.publishing.schemas import ScheduledFields, WritingFields
from app.reminders.schemas import ReminderSchedule
from app.schedule.schemas import PlanCreate, PlanFields
from app.templates.schemas import DayTemplateFields, NoteTemplateFields
from app.time_tracking.schemas import ActivityCreate
from app.workspaces.schemas import ChannelKind


class BackupRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")


class BackupBlob(BackupRecord):
    path: str = Field(pattern=r"^files/[0-9a-f]{32}$")
    size: int = Field(ge=0, le=MAX_FILE_SIZE)
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")


class BackupWorkspace(BackupRecord):
    id: UUID
    name: str = Field(min_length=1, max_length=80)
    icon: str = Field(min_length=1, max_length=8)
    position: int = Field(ge=0, le=2147483647)
    created_at: AwareDatetime
    image: BackupBlob | None = None
    image_type: Literal["image/png", "image/jpeg", "image/gif", "image/webp"] | None = None

    @model_validator(mode="after")
    def valid_image(self) -> "BackupWorkspace":
        if bool(self.image) != bool(self.image_type):
            raise ValueError("Incomplete project image")
        if self.image and self.image.size > MAX_ICON_SIZE:
            raise ValueError("Project image is too large")
        return self


class BackupCategory(BackupRecord):
    id: UUID
    workspace_id: UUID
    name: str = Field(min_length=1, max_length=80)
    position: int = Field(ge=0, le=2147483647)


class BackupChannel(BackupCategory):
    pinned_at: AwareDatetime | None = None
    kind: ChannelKind = "note"
    category_id: UUID | None
    created_at: AwareDatetime
    image: BackupBlob | None = None
    image_type: Literal["image/png", "image/jpeg", "image/gif", "image/webp"] | None = None

    @model_validator(mode="after")
    def valid_image(self) -> "BackupChannel":
        if bool(self.image) != bool(self.image_type):
            raise ValueError("Incomplete channel image")
        if self.image and self.image.size > MAX_ICON_SIZE:
            raise ValueError("Channel image is too large")
        return self


class BackupReminder(ReminderSchedule):
    model_config = ConfigDict(extra="forbid")
    scheduled_at: AwareDatetime
    status: Literal["active", "done"]


class BackupVersion(BackupRecord):
    content: str = Field(max_length=40000)
    written_at: AwareDatetime
    replaced_at: AwareDatetime


class BackupMessage(BackupRecord):
    id: UUID
    channel_id: UUID
    content: str = Field(max_length=40000)
    created_at: AwareDatetime
    updated_at: AwareDatetime
    reminder: BackupReminder | None = None
    thread_root_id: UUID | None = None
    versions: list[BackupVersion] = Field(default_factory=list, max_length=100)


class BackupJournal(BackupRecord):
    id: UUID
    channel_id: UUID
    title: str = Field(min_length=1, max_length=120)
    content: str = Field(max_length=200000)
    revision: int = Field(ge=1)
    created_at: AwareDatetime
    updated_at: AwareDatetime


class BackupAttachment(BackupRecord):
    id: UUID
    message_id: UUID
    filename: str = Field(min_length=1, max_length=255)
    content_type: str = Field(min_length=1, max_length=100)
    position: int = Field(ge=0, le=2147483647)
    created_at: AwareDatetime
    file: BackupBlob


class BackupDocument(BackupRecord):
    channel_id: UUID
    content: str = Field(max_length=200000)
    revision: int = Field(ge=1)
    created_at: AwareDatetime
    updated_at: AwareDatetime


class BackupActivity(ActivityCreate, BackupRecord):
    id: UUID
    position: int = Field(ge=0, le=2147483647)
    archived: bool
    revision: int = Field(default=1, ge=1)


class BackupTimeSession(BackupRecord):
    id: UUID
    activity_id: UUID
    started_at: AwareDatetime
    ended_at: AwareDatetime
    revision: int = Field(default=1, ge=1)


class BackupPlan(PlanCreate, BackupRecord):
    id: UUID
    revision: int = Field(default=1, ge=1)


class BackupPlanException(PlanFields, BackupRecord):
    plan_id: UUID
    occurrence_date: date
    deleted: bool


class BackupPlanEvent(BackupRecord):
    id: UUID
    plan_id: UUID
    occurrence_date: date
    created_at: AwareDatetime
    action: Literal["start", "stop", "delay", "other"]
    minutes: Literal[5, 10, 15, 30, 60] | None
    reason: str | None = Field(max_length=500)
    activity_id: UUID | None


class BackupScheduledMessage(ScheduledFields, BackupRecord):
    id: UUID
    channel_id: UUID
    status: Literal["pending", "sent", "skipped", "cancelled"]
    revision: int = Field(ge=1)
    created_at: AwareDatetime


class BackupWritingPrompt(WritingFields, BackupRecord):
    id: UUID
    channel_id: UUID


class BackupDayTemplate(DayTemplateFields, BackupRecord):
    id: UUID
    revision: int = Field(ge=1)


class BackupNoteTemplate(NoteTemplateFields, BackupRecord):
    id: UUID
    revision: int = Field(ge=1)


class BackupHabit(HabitFields, BackupRecord):
    archived: bool = False
    id: UUID
    revision: int = Field(ge=1)


class BackupHabitEntry(BackupRecord):
    habit_id: UUID
    day: date
    value: float = Field(ge=0, le=100000, allow_inf_nan=False)
    revision: int = Field(ge=1)


class BackupNutritionProfile(ProfileFields, BackupRecord):
    age_given_on: date


class BackupNutritionTarget(BackupRecord):
    starts_on: date
    resting: int = Field(ge=0, le=10000)
    maintenance: int = Field(ge=0, le=10000)
    kcal: int = Field(ge=800, le=6000)
    protein: int = Field(ge=0, le=400)
    carbs: int = Field(ge=0, le=900)
    fat: int = Field(ge=0, le=300)
    explanation: str = Field(default="", max_length=4000)
    sources: list[Source] = Field(default_factory=list, max_length=12)


class BackupSavedMeal(BackupRecord):
    id: UUID
    name: str = Field(min_length=1, max_length=80)
    items: list[MealItem] = Field(min_length=1, max_length=40)
    uses: int = Field(default=0, ge=0)
    photos: list[BackupBlob] = Field(default_factory=list, max_length=4)


class BackupMeal(BackupRecord):
    id: UUID
    day: date
    minute: int = Field(ge=0, le=1439)
    slot: Slot
    name: str = Field(min_length=1, max_length=80)
    items: list[MealItem] = Field(min_length=1, max_length=40)
    source: Literal["ai", "saved", "manual"] = "manual"
    saved_meal_id: UUID | None = None
    created_at: AwareDatetime
    photos: list[BackupBlob] = Field(default_factory=list, max_length=4)


class BackupWeighIn(BackupRecord):
    day: date
    weight_kg: float = Field(ge=30, le=300, allow_inf_nan=False)


class BackupAssistantTurn(BaseModel):
    photo_ids: list[UUID] = Field(default_factory=list, max_length=4)
    attached: dict[str, Any] | None = None
    role: Literal["user", "assistant"]
    content: str = Field(max_length=250000)
    proposal: dict[str, Any] | None = None
    sources: list[dict[str, Any]] = Field(default_factory=list, max_length=100)
    applied: bool = False
    created_at: AwareDatetime


class BackupAssistantChat(BaseModel):
    id: UUID
    title: str = Field(min_length=1, max_length=120)
    created_at: AwareDatetime
    updated_at: AwareDatetime
    turns: list[BackupAssistantTurn] = Field(default_factory=list)


class BackupChatPhoto(BackupRecord):
    id: UUID
    width: int = Field(gt=0, le=16000)
    height: int = Field(gt=0, le=16000)
    created_at: AwareDatetime
    file: BackupBlob


class BackupMemory(BaseModel):
    text: str = Field(min_length=1, max_length=300)
    created_at: AwareDatetime


class BackupFinanceAccount(AccountFields):
    id: UUID
    revision: int = Field(ge=1)


class BackupFinanceEntry(EntryFields):
    id: UUID
    revision: int = Field(ge=1)
    deleted: bool = False
    import_id: UUID | None = None
    occurrence_id: UUID | None = None
    created_at: AwareDatetime


class BackupFinanceItem(BackupRecord):
    id: UUID
    kind: Literal["purchase", "reservation", "payment", "occurrence", "import"]
    fields: dict[str, Any]
    revision: int = Field(ge=1)
    deleted: bool = False
    created_at: AwareDatetime


class BackupFinanceAsset(BackupRecord):
    id: UUID
    filename: str = Field(max_length=200)
    content_type: Literal["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"]
    file: BackupBlob
    created_at: AwareDatetime


class BackupFinance(BackupRecord):
    settings: FinanceProfileFields
    settings_revision: int = Field(default=1, ge=1)
    accounts: list[BackupFinanceAccount] = Field(default_factory=list, max_length=1000)
    entries: list[BackupFinanceEntry] = Field(default_factory=list)
    items: list[BackupFinanceItem] = Field(default_factory=list)
    assets: list[BackupFinanceAsset] = Field(default_factory=list, max_length=5000)


class BackupDocumentReminder(DocumentReminderCreate):
    model_config = ConfigDict(extra="forbid")
    channel_id: UUID
    status: Literal["active", "done", "cancelled"]
    revision: int = Field(ge=1)
    scheduled_at: AwareDatetime
    created_at: AwareDatetime


class BackupWritingRun(BackupRecord):
    id: UUID
    conversation_id: UUID | None
    created_at: AwareDatetime
    prompt_name: str = Field(max_length=80)
    instructions: str
    kind: str = Field(max_length=16)
    place: str = Field(max_length=16)
    channel_id: UUID | None
    where: str = Field(max_length=200)
    model: str = Field(max_length=80)
    input: list[dict[str, Any]]
    output: Any = None
    outcome: str = Field(max_length=16)
    error: str | None = None
    usage: dict[str, Any] | None = None


class BackupContent(BackupRecord):
    writing_runs: list[BackupWritingRun] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    assistant_photos: list[BackupChatPhoto] = Field(default_factory=list)
    preferences: BackupPreferences | None = None
    document_reminders: list[BackupDocumentReminder] = Field(default_factory=list)
    finance: BackupFinance | None = None
    habits: list[BackupHabit] = Field(default_factory=list)
    habit_entries: list[BackupHabitEntry] = Field(default_factory=list)
    format: Literal["noted-content-backup"] = "noted-content-backup"
    version: Literal[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16] = 1
    created_at: AwareDatetime
    workspaces: list[BackupWorkspace]
    categories: list[BackupCategory]
    channels: list[BackupChannel]
    messages: list[BackupMessage]
    attachments: list[BackupAttachment]
    journals: list[BackupJournal] = Field(default_factory=list)
    documents: list[BackupDocument] = Field(default_factory=list)
    activities: list[BackupActivity] = Field(default_factory=list)
    time_sessions: list[BackupTimeSession] = Field(default_factory=list)
    schedule_plans: list[BackupPlan] = Field(default_factory=list)
    schedule_exceptions: list[BackupPlanException] = Field(default_factory=list)
    plan_events: list[BackupPlanEvent] = Field(default_factory=list)
    scheduled_messages: list[BackupScheduledMessage] = Field(default_factory=list)
    writing_prompts: list[BackupWritingPrompt] = Field(default_factory=list)
    day_templates: list[BackupDayTemplate] = Field(default_factory=list)
    note_templates: list[BackupNoteTemplate] = Field(default_factory=list)
    nutrition_profile: BackupNutritionProfile | None = None
    nutrition_targets: list[BackupNutritionTarget] = Field(default_factory=list)
    saved_meals: list[BackupSavedMeal] = Field(default_factory=list)
    meals: list[BackupMeal] = Field(default_factory=list)
    weigh_ins: list[BackupWeighIn] = Field(default_factory=list)
    assistant_chats: list[BackupAssistantChat] = Field(default_factory=list)
    ai_memories: list[BackupMemory] = Field(default_factory=list)


class BackupCounts(BaseModel):
    finance_entries: int = 0
    assistant_chats: int = 0
    meals: int = 0
    habits: int = 0
    day_templates: int = 0
    note_templates: int = 0
    projects: int
    categories: int
    channels: int
    messages: int
    files: int
    journals: int = 0
    documents: int = 0
    activities: int = 0
    time_sessions: int = 0
    schedule_plans: int = 0
    scheduled_messages: int = 0
    writing_prompts: int = 0


class BackupPreview(BaseModel):
    warnings: list[str] = Field(default_factory=list)
    has_preferences: bool = False
    token: UUID
    created_at: datetime
    expires_at: datetime
    size: int
    counts: BackupCounts
    download_url: str | None = None


class ImportBackup(BackupRecord):
    restore_preferences: bool | None = None
    token: UUID
    mode: Literal["merge", "replace"] = "merge"
    confirmation: str = ""


class ImportResult(BaseModel):
    counts: BackupCounts
