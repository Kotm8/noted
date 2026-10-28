import sqlalchemy as sa

from alembic import op

revision = "0017_channel_tasks_pins"
down_revision = "0016_plan_end_prompts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("ck_channel_kind", "channels", type_="check")
    op.create_check_constraint(
        "ck_channel_kind",
        "channels",
        "kind IN ('note', 'reminder', 'journal', 'document', 'tasks')",
    )
    op.add_column("channels", sa.Column("pinned_at", sa.DateTime(timezone=True)))


def downgrade() -> None:
    op.drop_column("channels", "pinned_at")
    op.execute("UPDATE channels SET kind = 'note' WHERE kind = 'tasks'")
    op.drop_constraint("ck_channel_kind", "channels", type_="check")
    op.create_check_constraint(
        "ck_channel_kind", "channels", "kind IN ('note', 'reminder', 'journal', 'document')"
    )
