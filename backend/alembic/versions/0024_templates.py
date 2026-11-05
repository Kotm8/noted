import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0024_templates"
down_revision = "0023_message_history"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for name, payload in (
        ("note_templates", sa.Column("content", sa.Text(), nullable=False)),
        ("day_templates", sa.Column("blocks", postgresql.JSONB(), nullable=False)),
    ):
        op.create_table(
            name,
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column(
                "owner_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
            ),
            sa.Column("name", sa.String(70), nullable=False),
            payload,
            sa.Column("revision", sa.Integer(), nullable=False),
        )
        op.create_index(f"ix_{name}_owner_id", name, ["owner_id"])
    op.create_table(
        "template_applications",
        sa.Column("request_id", sa.Uuid(), primary_key=True),
        sa.Column(
            "owner_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("template_id", sa.Uuid(), nullable=False),
        sa.Column("template_revision", sa.Integer(), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("timezone", sa.String(64), nullable=False),
        sa.Column("plans", postgresql.JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_template_applications_owner_id", "template_applications", ["owner_id"])


def downgrade() -> None:
    op.drop_table("template_applications")
    op.drop_table("day_templates")
    op.drop_table("note_templates")
