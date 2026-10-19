import sqlalchemy as sa

from alembic import op

revision = "0013_home_activity"
down_revision = "0012_channel_documents"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for table in ("reminders", "plan_prompts"):
        op.add_column(
            table, sa.Column("read_revision", sa.Integer(), nullable=False, server_default="0")
        )


def downgrade() -> None:
    for table in ("reminders", "plan_prompts"):
        op.drop_column(table, "read_revision")
