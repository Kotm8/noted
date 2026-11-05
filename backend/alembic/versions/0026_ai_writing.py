import sqlalchemy as sa

from alembic import op

revision = "0026_ai_writing"
down_revision = "0025_ai"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE ai_prompts DROP COLUMN IF EXISTS web_search")
    op.add_column("ai_runs", sa.Column("conversation_id", sa.UUID(), nullable=True))
    op.create_index(
        "ix_ai_runs_owner_conversation_created",
        "ai_runs",
        ["owner_id", "conversation_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_ai_runs_owner_conversation_created", table_name="ai_runs")
    op.drop_column("ai_runs", "conversation_id")
    op.add_column(
        "ai_prompts",
        sa.Column("web_search", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.alter_column("ai_prompts", "web_search", server_default=None)
