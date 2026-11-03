import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0021_writing_nudges"
down_revision = "0020_reminder_urgent"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for table in ("activities", "schedule_plans", "schedule_exceptions"):
        op.add_column(table, sa.Column("writing_nudge", postgresql.JSONB(), nullable=True))
    op.create_table(
        "writing_nudge_runs",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "owner_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column(
            "activity_id",
            sa.Uuid(),
            sa.ForeignKey("activities.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "channel_id",
            sa.Uuid(),
            sa.ForeignKey("channels.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("settings", postgresql.JSONB(), nullable=False),
        sa.Column("remaining_seconds", sa.Float(), nullable=False),
        sa.Column("tracked_seconds", sa.Float(), nullable=False),
        sa.Column("resumed_at", sa.DateTime(timezone=True)),
        sa.Column("next_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_writing_nudge_runs_next_at", "writing_nudge_runs", ["next_at"])
    op.create_table(
        "writing_nudges",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "owner_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "channel_id",
            sa.Uuid(),
            sa.ForeignKey("channels.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("content", sa.String(500), nullable=False),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("read_revision", sa.Integer(), nullable=False),
    )
    op.create_index("ix_writing_nudges_channel_id", "writing_nudges", ["channel_id"])
    op.create_table(
        "writing_nudge_deliveries",
        sa.Column(
            "nudge_id",
            sa.Uuid(),
            sa.ForeignKey("writing_nudges.id", ondelete="CASCADE"),
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


def downgrade() -> None:
    for table in ("writing_nudge_deliveries", "writing_nudges", "writing_nudge_runs"):
        op.drop_table(table)
    for table in ("schedule_exceptions", "schedule_plans", "activities"):
        op.drop_column(table, "writing_nudge")
