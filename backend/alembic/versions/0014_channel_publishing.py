import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0014_channel_publishing"
down_revision = "0013_home_activity"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "scheduled_messages",
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
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("send_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("timezone", sa.String(64), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column(
            "message_id", sa.Uuid(), sa.ForeignKey("messages.id", ondelete="SET NULL"), unique=True
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint("status IN ('pending', 'sent', 'skipped', 'cancelled')"),
        sa.CheckConstraint("length(content) BETWEEN 1 AND 40000"),
    )
    op.create_index("ix_scheduled_messages_channel_id", "scheduled_messages", ["channel_id"])
    op.create_index("ix_scheduled_messages_due", "scheduled_messages", ["status", "send_at"])
    op.create_table(
        "writing_prompts",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "owner_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "channel_id",
            sa.Uuid(),
            sa.ForeignKey("channels.id", ondelete="CASCADE"),
            unique=True,
            nullable=False,
        ),
        sa.Column("content", sa.String(500), nullable=False),
        sa.Column("start_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("timezone", sa.String(64), nullable=False),
        sa.Column("frequency", sa.String(16), nullable=False),
        sa.Column("weekdays", postgresql.JSONB(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("next_at", sa.DateTime(timezone=True)),
        sa.Column("due_at", sa.DateTime(timezone=True)),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("read_revision", sa.Integer(), nullable=False, server_default="0"),
        sa.CheckConstraint("frequency IN ('daily', 'weekly', 'biweekly', 'monthly')"),
    )
    op.create_index("ix_writing_prompts_next", "writing_prompts", ["enabled", "next_at"])
    op.create_table(
        "writing_deliveries",
        sa.Column(
            "prompt_id",
            sa.Uuid(),
            sa.ForeignKey("writing_prompts.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "subscription_id",
            sa.Uuid(),
            sa.ForeignKey("push_subscriptions.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("revision", sa.Integer(), primary_key=True),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("retry_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("delivered_at", sa.DateTime(timezone=True)),
    )


def downgrade() -> None:
    op.drop_table("writing_deliveries")
    op.drop_table("writing_prompts")
    op.drop_table("scheduled_messages")
