import sqlalchemy as sa
from sqlalchemy.dialects import postgresql as pg

from alembic import op

revision = "0010_android_push"
down_revision = "0009_time_schedule"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "android_pairings",
        sa.Column("ticket_hash", sa.String(64), primary_key=True),
        sa.Column(
            "session_id",
            pg.UUID(),
            sa.ForeignKey("sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("device_id", pg.UUID(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_android_pairings_session_id", "android_pairings", ["session_id"])


def downgrade() -> None:
    op.drop_table("android_pairings")
