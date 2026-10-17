import sqlalchemy as sa

from alembic import op

revision = "0003_attachment_order"
down_revision = "0002_media_search"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "attachments", sa.Column("position", sa.Integer(), nullable=False, server_default="0")
    )
    op.execute(
        "UPDATE attachments SET position = ordered.position FROM "
        "(SELECT id, row_number() OVER (PARTITION BY message_id ORDER BY created_at, id) - 1 "
        "AS position FROM attachments) AS ordered WHERE attachments.id = ordered.id"
    )
    op.alter_column("attachments", "position", server_default=None)
    op.create_check_constraint("ck_attachments_position", "attachments", "position >= 0")


def downgrade() -> None:
    op.drop_constraint("ck_attachments_position", "attachments", type_="check")
    op.drop_column("attachments", "position")
