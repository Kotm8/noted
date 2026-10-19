import sqlalchemy as sa
from sqlalchemy.dialects import postgresql as pg

from alembic import op

revision = "0008_threads_journals"
down_revision = "0007_reminders"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("ck_channel_kind", "channels")
    op.create_check_constraint(
        "ck_channel_kind", "channels", "kind IN ('note', 'reminder', 'journal')"
    )
    op.add_column("messages", sa.Column("thread_root_id", pg.UUID(), nullable=True))
    op.create_unique_constraint("uq_messages_id_channel", "messages", ["id", "channel_id"])
    op.create_foreign_key(
        "fk_messages_thread_channel",
        "messages",
        "messages",
        ["thread_root_id", "channel_id"],
        ["id", "channel_id"],
        ondelete="CASCADE",
    )
    op.create_check_constraint(
        "ck_messages_thread_not_self", "messages", "thread_root_id IS NULL OR thread_root_id <> id"
    )
    op.create_index("ix_messages_thread_cursor", "messages", ["thread_root_id", "created_at", "id"])
    op.create_table(
        "journal_entries",
        sa.Column("id", pg.UUID(), primary_key=True),
        sa.Column(
            "channel_id",
            pg.UUID(),
            sa.ForeignKey("channels.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "author_id", pg.UUID(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("title", sa.String(120), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("revision > 0", name="ck_journal_revision"),
        sa.CheckConstraint("length(title) BETWEEN 1 AND 120", name="ck_journal_title"),
        sa.CheckConstraint("length(content) <= 200000", name="ck_journal_content"),
    )
    op.create_index(
        "ix_journal_channel_cursor", "journal_entries", ["channel_id", "created_at", "id"]
    )
    for column in ("title", "content"):
        op.create_index(
            f"ix_journal_{column}_trgm",
            "journal_entries",
            [column],
            postgresql_using="gin",
            postgresql_ops={column: "public.gin_trgm_ops"},
        )


def downgrade() -> None:
    op.drop_table("journal_entries")
    op.execute("DELETE FROM messages WHERE thread_root_id IS NOT NULL")
    op.drop_constraint("fk_messages_thread_channel", "messages")
    op.drop_constraint("ck_messages_thread_not_self", "messages")
    op.drop_constraint("uq_messages_id_channel", "messages")
    op.drop_index("ix_messages_thread_cursor", "messages")
    op.drop_column("messages", "thread_root_id")
    op.execute("UPDATE channels SET kind = 'note' WHERE kind = 'journal'")
    op.drop_constraint("ck_channel_kind", "channels")
    op.create_check_constraint("ck_channel_kind", "channels", "kind IN ('note', 'reminder')")
