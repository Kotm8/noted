import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0029_habits"
down_revision = "0028_work_schedule"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "habits",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "owner_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("name", sa.String(60), nullable=False),
        sa.Column("kind", sa.String(8), nullable=False),
        sa.Column("goal", sa.Float(), nullable=False),
        sa.Column("unit", sa.String(20), nullable=False),
        sa.Column("period", sa.String(8), nullable=False),
        sa.Column("weekdays", postgresql.JSONB(), nullable=False),
        sa.Column("activity_id", sa.Uuid(), sa.ForeignKey("activities.id")),
        sa.Column("timezone", sa.String(64), nullable=False),
        sa.Column("starts_on", sa.Date(), nullable=False),
        sa.Column("reminder_start", sa.Date()),
        sa.Column("reminder_minute", sa.Integer()),
        sa.Column("next_reminder_at", sa.DateTime(timezone=True)),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("archived", sa.Boolean(), nullable=False),
        sa.CheckConstraint("goal > 0 AND goal <= 100000"),
        sa.CheckConstraint("kind IN ('check', 'count', 'time')"),
        sa.CheckConstraint("period IN ('Morning', 'Anytime', 'Evening')"),
    )
    op.create_index("ix_habits_owner", "habits", ["owner_id"])
    op.create_index("ix_habits_next_reminder_at", "habits", ["next_reminder_at"])
    op.create_table(
        "habit_entries",
        sa.Column(
            "habit_id", sa.Uuid(), sa.ForeignKey("habits.id", ondelete="CASCADE"), primary_key=True
        ),
        sa.Column("day", sa.Date(), primary_key=True),
        sa.Column("value", sa.Float(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
    )
    op.create_table(
        "habit_reminders",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "owner_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "habit_id", sa.Uuid(), sa.ForeignKey("habits.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("read_revision", sa.Integer(), nullable=False),
    )
    op.create_index("uq_habit_reminder_day", "habit_reminders", ["habit_id", "day"], unique=True)
    op.create_table(
        "habit_deliveries",
        sa.Column(
            "reminder_id",
            sa.Uuid(),
            sa.ForeignKey("habit_reminders.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "subscription_id",
            sa.Uuid(),
            sa.ForeignKey("push_subscriptions.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("revision", sa.Integer(), primary_key=True),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("delivered_at", sa.DateTime(timezone=True)),
        sa.Column("retry_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "ai_assistant_applications",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "owner_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("fingerprint", sa.String(64), nullable=False),
        sa.Column("result", postgresql.JSONB(), nullable=False),
    )


def downgrade() -> None:
    for table in (
        "ai_assistant_applications",
        "habit_deliveries",
        "habit_reminders",
        "habit_entries",
        "habits",
    ):
        op.drop_table(table)
