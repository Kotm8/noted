import sqlalchemy as sa

from alembic import op

revision = "0002_media_search"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("workspaces", sa.Column("icon_storage_key", sa.String(96), nullable=True))
    op.add_column("workspaces", sa.Column("icon_content_type", sa.String(100), nullable=True))
    op.add_column("workspaces", sa.Column("icon_size", sa.Integer(), nullable=True))
    op.create_table(
        "attachments",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "message_id",
            sa.Uuid(),
            sa.ForeignKey("messages.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("original_filename", sa.String(255), nullable=False),
        sa.Column("storage_key", sa.String(96), nullable=False, unique=True),
        sa.Column("content_type", sa.String(100), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("size >= 0", name="ck_attachments_size"),
    )
    op.create_index("ix_attachments_message_id", "attachments", ["message_id"])
    op.drop_constraint("messages_content_check", "messages", type_="check")
    op.create_check_constraint(
        "ck_messages_content_length", "messages", "length(content) BETWEEN 0 AND 40000"
    )
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public")
    op.create_index(
        "ix_messages_content_trgm",
        "messages",
        ["content"],
        postgresql_using="gin",
        postgresql_ops={"content": "public.gin_trgm_ops"},
        postgresql_where=sa.text("deleted_at IS NULL"),
    )


def downgrade() -> None:
    connection = op.get_bind()
    has_file_only_notes = connection.scalar(
        sa.text("SELECT EXISTS(SELECT 1 FROM messages WHERE length(content) = 0)")
    )
    if has_file_only_notes:
        raise RuntimeError(
            "File-only notes require a backup restore to return to the previous schema."
        )
    op.drop_index("ix_messages_content_trgm", table_name="messages")
    op.drop_constraint("ck_messages_content_length", "messages", type_="check")
    op.create_check_constraint(
        "messages_content_check", "messages", "length(content) BETWEEN 1 AND 40000"
    )
    op.drop_table("attachments")
    op.drop_column("workspaces", "icon_size")
    op.drop_column("workspaces", "icon_content_type")
    op.drop_column("workspaces", "icon_storage_key")
