import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0031_assistant_chats"
down_revision = "0030_nutrition"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "messages",
        sa.Column("ai_generated", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_table(
        "ai_assistant_chats",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column(
            "owner_id", sa.UUID(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("title", sa.String(120), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_ai_assistant_chats_owner_updated", "ai_assistant_chats", ["owner_id", "updated_at"]
    )
    op.create_table(
        "ai_assistant_turns",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column(
            "chat_id",
            sa.UUID(),
            sa.ForeignKey("ai_assistant_chats.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "owner_id", sa.UUID(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("role", sa.String(16), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("proposal", postgresql.JSONB(), nullable=True),
        sa.Column("sources", postgresql.JSONB(), nullable=False),
        sa.Column("photo_ids", postgresql.JSONB(), nullable=False),
        sa.Column("attached", postgresql.JSONB(), nullable=True),
        sa.Column("applied", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_ai_assistant_turns_chat_created", "ai_assistant_turns", ["chat_id", "created_at"]
    )
    op.create_table(
        "ai_memories",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column(
            "owner_id", sa.UUID(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("text", sa.String(300), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_ai_memories_owner_created", "ai_memories", ["owner_id", "created_at"])


def downgrade() -> None:
    op.drop_column("messages", "ai_generated")
    op.drop_table("ai_memories")
    op.drop_table("ai_assistant_turns")
    op.drop_table("ai_assistant_chats")
