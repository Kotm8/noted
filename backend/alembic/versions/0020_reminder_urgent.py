import sqlalchemy as sa

from alembic import op

revision = "0020_reminder_urgent"
down_revision = "0019_plan_prompt_switch"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "reminders",
        sa.Column("urgent", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("reminders", "urgent")
