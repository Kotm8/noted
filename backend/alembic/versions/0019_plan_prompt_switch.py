import sqlalchemy as sa

from alembic import op

revision = "0019_plan_prompt_switch"
down_revision = "0018_watch_live_sync"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "plan_prompts",
        sa.Column(
            "switch_activity_id",
            sa.UUID(),
            sa.ForeignKey(
                "activities.id", ondelete="SET NULL", name="fk_plan_prompt_switch_activity"
            ),
        ),
    )
    op.add_column("plan_prompts", sa.Column("switch_title", sa.String(120)))


def downgrade() -> None:
    op.drop_column("plan_prompts", "switch_title")
    op.drop_column("plan_prompts", "switch_activity_id")
