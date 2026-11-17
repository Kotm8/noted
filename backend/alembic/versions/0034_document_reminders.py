from alembic import op

revision = "0034_document_reminders"
down_revision = "0033_finance"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
CREATE TABLE document_reminders (
	id UUID NOT NULL, 
	channel_id UUID NOT NULL, 
	owner_id UUID NOT NULL, 
	name VARCHAR(500) NOT NULL, 
	due_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	timezone VARCHAR(64) NOT NULL, 
	repeat VARCHAR(16) NOT NULL, 
	urgent BOOLEAN NOT NULL, 
	status VARCHAR(16) NOT NULL, 
	revision INTEGER NOT NULL, 
	read_revision INTEGER NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	CHECK (repeat IN ('none', 'daily', 'weekdays', 'weekly')), 
	CHECK (status IN ('active', 'done', 'cancelled')), 
	CHECK (revision > 0), 
	CHECK (length(name) BETWEEN 1 AND 500), 
	FOREIGN KEY(channel_id) REFERENCES channels (id) ON DELETE CASCADE, 
	FOREIGN KEY(owner_id) REFERENCES users (id) ON DELETE CASCADE
)
    """)
    op.execute("CREATE INDEX ix_document_reminders_channel_id ON document_reminders (channel_id)")
    op.execute("CREATE INDEX ix_document_reminders_due_at ON document_reminders (due_at)")
    op.execute("""
CREATE TABLE document_reminder_deliveries (
	reminder_id UUID NOT NULL, 
	subscription_id UUID NOT NULL, 
	revision INTEGER NOT NULL, 
	attempts INTEGER NOT NULL, 
	delivered_at TIMESTAMP WITH TIME ZONE, 
	retry_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (reminder_id, subscription_id, revision), 
	FOREIGN KEY(reminder_id) REFERENCES document_reminders (id) ON DELETE CASCADE, 
	FOREIGN KEY(subscription_id) REFERENCES push_subscriptions (id) ON DELETE CASCADE
)
    """)


def downgrade() -> None:
    op.drop_table("document_reminder_deliveries")
    op.drop_table("document_reminders")
