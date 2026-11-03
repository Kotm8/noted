import sqlalchemy as sa

from alembic import op

revision = "0018_watch_live_sync"
down_revision = "0017_channel_tasks_pins"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "watch_sync_state",
        sa.Column(
            "subscription_id",
            sa.UUID(),
            sa.ForeignKey("push_subscriptions.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("requested_at", sa.DateTime(timezone=True)),
        sa.Column("last_sent_at", sa.DateTime(timezone=True)),
    )


def downgrade() -> None:
    op.drop_table("watch_sync_state")
