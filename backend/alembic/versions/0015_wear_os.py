import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0015_wear_os"
down_revision = "0014_channel_publishing"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("watch_preferences", postgresql.JSONB(), nullable=True))
    op.create_table(
        "watch_pairings",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("ticket_hash", sa.String(64), nullable=False, unique=True),
        sa.Column(
            "session_id",
            sa.Uuid(),
            sa.ForeignKey("sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_watch_pairings_expires_at", "watch_pairings", ["expires_at"])
    op.create_table(
        "watch_devices",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "session_id",
            sa.Uuid(),
            sa.ForeignKey("sessions.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("secret_hash", sa.String(64), nullable=False, unique=True),
    )


def downgrade() -> None:
    op.drop_table("watch_devices")
    op.drop_table("watch_pairings")
    op.drop_column("users", "watch_preferences")
