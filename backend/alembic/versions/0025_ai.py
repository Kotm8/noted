import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision = "0025_ai"
down_revision = "0024_templates"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("ai_preferences", JSONB()))
    op.create_table(
        "ai_prompts",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column(
            "owner_id", sa.UUID(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("name", sa.String(60), nullable=False),
        sa.Column("instructions", sa.Text(), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("places", JSONB(), nullable=False),
        sa.Column("sees", sa.String(16), nullable=False),
        sa.Column("web_search", sa.Boolean(), nullable=False),
        sa.Column("model", sa.String(80)),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.CheckConstraint(
            "kind IN ('rewrite', 'reply', 'draft', 'answer')", name="ck_ai_prompt_kind"
        ),
        sa.CheckConstraint("sees IN ('selection', 'channel_today')", name="ck_ai_prompt_sees"),
    )
    op.create_index("ix_ai_prompts_owner_id", "ai_prompts", ["owner_id"])
    op.create_table(
        "ai_runs",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column(
            "owner_id", sa.UUID(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("prompt_name", sa.String(80), nullable=False),
        sa.Column("instructions", sa.Text(), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("place", sa.String(16), nullable=False),
        sa.Column("channel_id", sa.UUID(), sa.ForeignKey("channels.id", ondelete="SET NULL")),
        sa.Column("where", sa.String(200), nullable=False),
        sa.Column("model", sa.String(80), nullable=False),
        sa.Column("input", JSONB(), nullable=False),
        sa.Column("output", JSONB()),
        sa.Column("outcome", sa.String(16), nullable=False),
        sa.Column("error", sa.Text()),
        sa.Column("usage", JSONB()),
    )
    op.create_index("ix_ai_runs_owner_created", "ai_runs", ["owner_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_ai_runs_owner_created", table_name="ai_runs")
    op.drop_table("ai_runs")
    op.drop_index("ix_ai_prompts_owner_id", table_name="ai_prompts")
    op.drop_table("ai_prompts")
    op.drop_column("users", "ai_preferences")
