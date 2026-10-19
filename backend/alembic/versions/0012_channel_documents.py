import sqlalchemy as sa

from alembic import op

revision = "0012_channel_documents"
down_revision = "0011_plan_prompts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("ck_channel_kind", "channels")
    op.create_check_constraint(
        "ck_channel_kind", "channels", "kind IN ('note', 'reminder', 'journal', 'document')"
    )
    op.create_table(
        "channel_documents",
        sa.Column("channel_id", sa.UUID(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["channel_id"], ["channels.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("channel_id"),
        sa.CheckConstraint("revision > 0", name="ck_document_revision"),
        sa.CheckConstraint("length(content) <= 200000", name="ck_document_content"),
    )
    op.create_index(
        "ix_document_content_trgm",
        "channel_documents",
        ["content"],
        postgresql_using="gin",
        postgresql_ops={"content": "public.gin_trgm_ops"},
    )


def downgrade() -> None:
    if op.get_bind().scalar(sa.text("SELECT count(*) FROM channels WHERE kind = 'document'")):
        raise RuntimeError("Remove Notes channels before downgrading this schema.")
    op.drop_table("channel_documents")
    op.drop_constraint("ck_channel_kind", "channels")
    op.create_check_constraint(
        "ck_channel_kind", "channels", "kind IN ('note', 'reminder', 'journal')"
    )
