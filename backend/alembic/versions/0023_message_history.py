import sqlalchemy as sa

from alembic import op

revision = "0023_message_history"
down_revision = "0022_image_previews"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "message_versions",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column(
            "message_id",
            sa.UUID(),
            sa.ForeignKey("messages.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("written_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("replaced_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_message_versions_message", "message_versions", ["message_id", "replaced_at"]
    )
    op.add_column("messages", sa.Column("client_id", sa.UUID()))
    op.create_index(
        "uq_messages_author_client",
        "messages",
        ["author_id", "client_id"],
        unique=True,
        postgresql_where=sa.text("client_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_messages_author_client", table_name="messages")
    op.drop_column("messages", "client_id")
    op.drop_index("ix_message_versions_message", table_name="message_versions")
    op.drop_table("message_versions")
