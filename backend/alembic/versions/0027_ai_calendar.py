import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0027_ai_calendar"
down_revision = "0026_ai_writing"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ai_calendar_applications",
        sa.Column("request_id", sa.UUID(), primary_key=True),
        sa.Column(
            "owner_id", sa.UUID(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("fingerprint", sa.String(64), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("applied", sa.Boolean(), nullable=False),
        sa.Column("plans", postgresql.JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_ai_calendar_applications_owner_id", "ai_calendar_applications", ["owner_id"]
    )


def downgrade() -> None:
    op.drop_table("ai_calendar_applications")
