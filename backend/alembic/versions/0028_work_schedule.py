import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0028_work_schedule"
down_revision = "0027_ai_calendar"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "tracker_state",
        sa.Column(
            "work_schedule",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )


def downgrade() -> None:
    op.drop_column("tracker_state", "work_schedule")
