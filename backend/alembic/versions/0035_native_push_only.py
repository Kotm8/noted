from alembic import op

revision = "0035_native_push_only"
down_revision = "0034_document_reminders"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("DELETE FROM push_subscriptions WHERE endpoint NOT LIKE 'fcm:%'")
    op.drop_table("notification_keys")


def downgrade() -> None:
    op.execute("""
CREATE TABLE notification_keys (
    id INTEGER NOT NULL PRIMARY KEY,
    private_key TEXT NOT NULL
)
    """)
