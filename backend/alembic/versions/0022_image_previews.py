import sqlalchemy as sa

from alembic import op

revision = "0022_image_previews"
down_revision = "0021_writing_nudges"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for name in ("width", "height", "preview_size"):
        op.add_column("attachments", sa.Column(name, sa.Integer(), nullable=True))
    op.add_column("attachments", sa.Column("preview_storage_key", sa.String(96), nullable=True))
    op.add_column(
        "attachments",
        sa.Column("preview_failed", sa.Boolean(), server_default=sa.false(), nullable=False),
    )
    op.create_index(
        "ix_attachments_pending_preview",
        "attachments",
        ["created_at", "id"],
        postgresql_where=sa.text(
            "preview_storage_key IS NULL AND preview_failed = false "
            "AND content_type IN ('image/png', 'image/jpeg', 'image/gif', 'image/webp')"
        ),
    )


def downgrade() -> None:
    op.drop_index("ix_attachments_pending_preview", table_name="attachments")
    for name in ("preview_failed", "preview_storage_key", "preview_size", "height", "width"):
        op.drop_column("attachments", name)
