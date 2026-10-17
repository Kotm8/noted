import sqlalchemy as sa
from sqlalchemy.dialects import postgresql as pg

from alembic import op

revision = "0007_reminders"
down_revision = "0006_channel_banners"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "channels", sa.Column("kind", sa.String(16), nullable=False, server_default="note")
    )
    op.create_check_constraint("ck_channel_kind", "channels", "kind IN ('note', 'reminder')")
    op.add_column("users", sa.Column("notification_preferences", pg.JSONB(), nullable=True))
    op.create_table(
        "reminders",
        sa.Column(
            "message_id",
            pg.UUID(),
            sa.ForeignKey("messages.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("scheduled_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("timezone", sa.String(64), nullable=False),
        sa.Column("repeat", sa.String(16), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.CheckConstraint("repeat IN ('none', 'daily', 'weekdays', 'weekly')"),
        sa.CheckConstraint("status IN ('active', 'done')"),
        sa.CheckConstraint("revision > 0"),
    )
    op.create_index("ix_reminders_due_at", "reminders", ["due_at"])
    op.create_table(
        "notification_keys",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("private_key", sa.Text(), nullable=False),
    )
    op.create_table(
        "push_subscriptions",
        sa.Column("id", pg.UUID(), primary_key=True),
        sa.Column(
            "session_id",
            pg.UUID(),
            sa.ForeignKey("sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("device_id", pg.UUID(), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("endpoint", sa.Text(), nullable=False, unique=True),
        sa.Column("keys", pg.JSONB(), nullable=False),
    )
    op.create_table(
        "device_presence",
        sa.Column(
            "session_id",
            pg.UUID(),
            sa.ForeignKey("sessions.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("device_id", pg.UUID(), primary_key=True),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("focused", sa.Boolean(), nullable=False),
        sa.Column("seen_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "notification_deliveries",
        sa.Column(
            "message_id",
            pg.UUID(),
            sa.ForeignKey("reminders.message_id", ondelete="CASCADE"),
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
        sa.Column("delivered_at", sa.DateTime(timezone=True)),
        sa.Column("retry_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    for name in (
        "notification_deliveries",
        "device_presence",
        "push_subscriptions",
        "notification_keys",
        "reminders",
    ):
        op.drop_table(name)
    op.drop_column("users", "notification_preferences")
    op.drop_constraint("ck_channel_kind", "channels")
    op.drop_column("channels", "kind")
