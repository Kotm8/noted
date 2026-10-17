import sqlalchemy as sa

from alembic import op

revision = "0006_channel_banners"
down_revision = "0005_user_appearance"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("channels", sa.Column("banner_storage_key", sa.String(96), nullable=True))
    op.add_column("channels", sa.Column("banner_content_type", sa.String(100), nullable=True))
    op.add_column("channels", sa.Column("banner_size", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("channels", "banner_size")
    op.drop_column("channels", "banner_content_type")
    op.drop_column("channels", "banner_storage_key")
