import sqlalchemy as sa
from sqlalchemy.dialects import postgresql as pg

from alembic import op

revision = "0009_time_schedule"
down_revision = "0008_threads_journals"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "activities",
        sa.Column("id", pg.UUID(), primary_key=True),
        sa.Column(
            "owner_id", pg.UUID(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("name", sa.String(60), nullable=False),
        sa.Column("icon", sa.String(32), nullable=False),
        sa.Column("color", sa.String(7), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("archived", sa.Boolean(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.CheckConstraint("position >= 0"),
    )
    op.create_index("ix_activities_owner_id", "activities", ["owner_id"])
    op.create_index(
        "uq_activity_name", "activities", ["owner_id", sa.text("lower(name)")], unique=True
    )
    op.create_table(
        "time_sessions",
        sa.Column("id", pg.UUID(), primary_key=True),
        sa.Column(
            "owner_id", pg.UUID(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("activity_id", pg.UUID(), sa.ForeignKey("activities.id"), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True)),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.CheckConstraint("ended_at IS NULL OR ended_at > started_at"),
    )
    op.create_index("ix_time_sessions_cursor", "time_sessions", ["owner_id", "started_at", "id"])
    op.create_index(
        "uq_active_time_session",
        "time_sessions",
        ["owner_id"],
        unique=True,
        postgresql_where=sa.text("ended_at IS NULL"),
    )
    op.create_table(
        "tracker_state",
        sa.Column(
            "owner_id", pg.UUID(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
        ),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("last_request_id", pg.UUID()),
        sa.Column("paused_activity_id", pg.UUID(), sa.ForeignKey("activities.id")),
        sa.Column("elapsed_seconds", sa.Integer(), nullable=False),
        sa.Column("start_minute", sa.Integer(), nullable=False),
        sa.Column("end_minute", sa.Integer(), nullable=False),
        sa.Column("timezone", sa.String(64), nullable=False),
        sa.CheckConstraint(
            "start_minute >= 0 AND end_minute <= 1440 AND end_minute - start_minute >= 60"
        ),
    )
    op.create_table(
        "schedule_plans",
        sa.Column("id", pg.UUID(), primary_key=True),
        sa.Column(
            "owner_id", pg.UUID(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("activity_id", pg.UUID(), sa.ForeignKey("activities.id"), nullable=False),
        sa.Column("title", sa.String(120), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("start_minute", sa.Integer(), nullable=False),
        sa.Column("end_minute", sa.Integer(), nullable=False),
        sa.Column("timezone", sa.String(64), nullable=False),
        sa.Column("frequency", sa.String(16), nullable=False),
        sa.Column("weekdays", pg.JSONB(), nullable=False),
        sa.Column("repeat_until", sa.Date()),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint(
            "start_minute >= 0 AND end_minute <= 1440 AND end_minute > start_minute"
        ),
        sa.CheckConstraint("frequency IN ('none', 'daily', 'weekly', 'biweekly', 'monthly')"),
    )
    op.create_index("ix_schedule_owner_date", "schedule_plans", ["owner_id", "date"])
    op.create_table(
        "schedule_exceptions",
        sa.Column(
            "plan_id",
            pg.UUID(),
            sa.ForeignKey("schedule_plans.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("occurrence_date", sa.Date(), primary_key=True),
        sa.Column("activity_id", pg.UUID(), sa.ForeignKey("activities.id"), nullable=False),
        sa.Column("title", sa.String(120), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("start_minute", sa.Integer(), nullable=False),
        sa.Column("end_minute", sa.Integer(), nullable=False),
        sa.Column("timezone", sa.String(64), nullable=False),
        sa.Column("deleted", sa.Boolean(), nullable=False),
        sa.CheckConstraint(
            "start_minute >= 0 AND end_minute <= 1440 AND end_minute > start_minute"
        ),
    )


def downgrade() -> None:
    for table in (
        "schedule_exceptions",
        "schedule_plans",
        "tracker_state",
        "time_sessions",
        "activities",
    ):
        op.drop_table(table)
