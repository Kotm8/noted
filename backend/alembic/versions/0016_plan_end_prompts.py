import sqlalchemy as sa

from alembic import op

revision = "0016_plan_end_prompts"
down_revision = "0015_wear_os"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "plan_prompts", sa.Column("phase", sa.String(8), nullable=False, server_default="start")
    )
    op.add_column("plan_prompts", sa.Column("planned_end", sa.DateTime(timezone=True)))
    op.add_column("plan_prompts", sa.Column("tracked_session_id", sa.Uuid()))
    op.create_foreign_key(
        "fk_plan_prompt_tracked_session",
        "plan_prompts",
        "time_sessions",
        ["tracked_session_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_check_constraint("ck_plan_prompt_phase", "plan_prompts", "phase IN ('start', 'end')")


def downgrade() -> None:
    op.drop_constraint("ck_plan_prompt_phase", "plan_prompts", type_="check")
    op.drop_constraint("fk_plan_prompt_tracked_session", "plan_prompts", type_="foreignkey")
    for column in ("tracked_session_id", "planned_end", "phase"):
        op.drop_column("plan_prompts", column)
