import sqlalchemy as sa

from alembic import op

revision = "0004_session_details"
down_revision = "0003_attachment_order"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("sessions", sa.Column("created_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("sessions", sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("sessions", sa.Column("user_agent", sa.String(512), nullable=True))
    op.alter_column("sessions", "created_at", server_default=sa.func.now())
    op.alter_column("sessions", "last_seen_at", server_default=sa.func.now())


def downgrade() -> None:
    op.drop_column("sessions", "user_agent")
    op.drop_column("sessions", "last_seen_at")
    op.drop_column("sessions", "created_at")
