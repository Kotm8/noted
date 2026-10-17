import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0005_user_appearance"
down_revision = "0004_session_details"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("appearance", postgresql.JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "appearance")
