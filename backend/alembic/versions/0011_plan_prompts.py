import sqlalchemy as sa
from sqlalchemy.dialects import postgresql as pg

from alembic import op

revision = "0011_plan_prompts"
down_revision = "0010_android_push"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for table in ("schedule_plans", "schedule_exceptions"):
        op.add_column(
            table,
            sa.Column(
                "notifications_enabled", sa.Boolean(), nullable=False, server_default=sa.true()
            ),
        )
        op.add_column(table, sa.Column("notification_minutes", sa.Integer()))
        op.create_check_constraint(
            f"ck_{table}_notice_minutes",
            table,
            "notification_minutes IS NULL OR notification_minutes IN (0, 1, 5, 10)",
        )
    op.create_table(
        "plan_prompts",
        sa.Column("id", pg.UUID(), primary_key=True),
        sa.Column(
            "plan_id",
            pg.UUID(),
            sa.ForeignKey("schedule_plans.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "owner_id", pg.UUID(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("occurrence_date", sa.Date(), nullable=False),
        sa.Column("activity_id", pg.UUID(), sa.ForeignKey("activities.id"), nullable=False),
        sa.Column("title", sa.String(120), nullable=False),
        sa.Column("planned_start", sa.DateTime(timezone=True), nullable=False),
        sa.Column("scheduled_notice_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("notify_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("delayed", sa.Boolean(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("last_request_id", pg.UUID()),
        sa.UniqueConstraint("plan_id", "occurrence_date"),
    )
    op.create_index("ix_plan_prompts_owner_id", "plan_prompts", ["owner_id"])
    op.create_table(
        "plan_prompt_events",
        sa.Column("id", pg.UUID(), primary_key=True),
        sa.Column(
            "plan_id",
            pg.UUID(),
            sa.ForeignKey("schedule_plans.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("occurrence_date", sa.Date(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("action", sa.String(16), nullable=False),
        sa.Column("minutes", sa.Integer()),
        sa.Column("reason", sa.String(500)),
        sa.Column("activity_id", pg.UUID(), sa.ForeignKey("activities.id", ondelete="SET NULL")),
    )
    op.create_index("ix_plan_prompt_events_plan_id", "plan_prompt_events", ["plan_id"])
    op.create_table(
        "plan_prompt_deliveries",
        sa.Column(
            "prompt_id",
            pg.UUID(),
            sa.ForeignKey("plan_prompts.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "subscription_id",
            pg.UUID(),
            sa.ForeignKey("push_subscriptions.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("revision", sa.Integer(), primary_key=True),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("retry_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("delivered_at", sa.DateTime(timezone=True)),
    )


def downgrade() -> None:
    for table in ("plan_prompt_deliveries", "plan_prompt_events", "plan_prompts"):
        op.drop_table(table)
    for table in ("schedule_plans", "schedule_exceptions"):
        op.drop_constraint(f"ck_{table}_notice_minutes", table, type_="check")
        op.drop_column(table, "notification_minutes")
        op.drop_column(table, "notifications_enabled")
