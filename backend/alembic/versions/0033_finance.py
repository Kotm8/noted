from alembic import op

revision = "0033_finance"
down_revision = "0032_saved_food_photos"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
CREATE TABLE finance_accounts (
	id UUID NOT NULL, 
	owner_id UUID NOT NULL, 
	name VARCHAR(80) NOT NULL, 
	opening_balance BIGINT NOT NULL, 
	archived BOOLEAN NOT NULL, 
	revision INTEGER NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(owner_id) REFERENCES users (id) ON DELETE CASCADE
)
    """)
    op.execute("CREATE INDEX ix_finance_accounts_owner ON finance_accounts (owner_id)")
    op.execute("""
CREATE TABLE finance_assets (
	id UUID NOT NULL, 
	owner_id UUID NOT NULL, 
	storage_key VARCHAR(96) NOT NULL, 
	content_type VARCHAR(80) NOT NULL, 
	size BIGINT NOT NULL, 
	filename VARCHAR(200) NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(owner_id) REFERENCES users (id) ON DELETE CASCADE
)
    """)
    op.execute("CREATE INDEX ix_finance_assets_owner ON finance_assets (owner_id)")
    op.execute("""
CREATE TABLE finance_items (
	id UUID NOT NULL, 
	owner_id UUID NOT NULL, 
	kind VARCHAR(12) NOT NULL, 
	fields JSONB NOT NULL, 
	deleted BOOLEAN NOT NULL, 
	revision INTEGER NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT ck_finance_item_kind CHECK (
		kind IN ('purchase', 'reservation', 'payment', 'occurrence', 'import')
	),
	FOREIGN KEY(owner_id) REFERENCES users (id) ON DELETE CASCADE
)
    """)
    op.execute("CREATE INDEX ix_finance_items_owner_kind ON finance_items (owner_id, kind)")
    op.execute("""
CREATE TABLE finance_mutations (
	id UUID NOT NULL, 
	owner_id UUID NOT NULL, 
	fingerprint VARCHAR(64) NOT NULL, 
	result JSONB NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(owner_id) REFERENCES users (id) ON DELETE CASCADE
)
    """)
    op.execute("""
CREATE TABLE finance_profiles (
	owner_id UUID NOT NULL, 
	currency VARCHAR(3) NOT NULL, 
	gauge_maximum BIGINT NOT NULL, 
	savings_mode VARCHAR(8) NOT NULL, 
	savings_value BIGINT NOT NULL, 
	payment_reminder_days INTEGER, 
	reminder_minute INTEGER NOT NULL, 
	categories JSONB NOT NULL, 
	paydays JSONB NOT NULL, 
	default_account_id UUID, 
	revision INTEGER NOT NULL, 
	PRIMARY KEY (owner_id), 
	FOREIGN KEY(owner_id) REFERENCES users (id) ON DELETE CASCADE
)
    """)
    op.execute("""
CREATE TABLE finance_entries (
	id UUID NOT NULL, 
	owner_id UUID NOT NULL, 
	account_id UUID NOT NULL, 
	target_account_id UUID, 
	kind VARCHAR(8) NOT NULL, 
	amount BIGINT NOT NULL, 
	day DATE NOT NULL, 
	name VARCHAR(200) NOT NULL, 
	category VARCHAR(80) NOT NULL, 
	notes VARCHAR(8000) NOT NULL, 
	photo_ids JSONB NOT NULL, 
	payday_date DATE, 
	import_id UUID, 
	occurrence_id UUID, 
	deleted BOOLEAN NOT NULL, 
	revision INTEGER NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT ck_finance_entry_amount CHECK (amount > 0), 
	CONSTRAINT ck_finance_entry_kind CHECK (kind IN ('income', 'expense', 'transfer')), 
	CONSTRAINT ck_finance_transfer_target CHECK (
		(kind = 'transfer' AND target_account_id IS NOT NULL AND target_account_id <> account_id)
		OR (kind <> 'transfer' AND target_account_id IS NULL)
	),
	FOREIGN KEY(owner_id) REFERENCES users (id) ON DELETE CASCADE, 
	FOREIGN KEY(account_id) REFERENCES finance_accounts (id), 
	FOREIGN KEY(target_account_id) REFERENCES finance_accounts (id)
)
    """)
    op.execute("CREATE INDEX ix_finance_entries_owner_day ON finance_entries (owner_id, day)")
    op.execute("""
CREATE TABLE finance_deliveries (
	occurrence_id UUID NOT NULL, 
	subscription_id UUID NOT NULL, 
	revision INTEGER NOT NULL, 
	attempts INTEGER NOT NULL, 
	delivered_at TIMESTAMP WITH TIME ZONE, 
	retry_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (occurrence_id, subscription_id, revision), 
	FOREIGN KEY(occurrence_id) REFERENCES finance_items (id) ON DELETE CASCADE, 
	FOREIGN KEY(subscription_id) REFERENCES push_subscriptions (id) ON DELETE CASCADE
)
    """)


def downgrade() -> None:
    op.drop_table("finance_deliveries")
    op.drop_table("finance_entries")
    op.drop_table("finance_profiles")
    op.drop_table("finance_mutations")
    op.drop_table("finance_items")
    op.drop_table("finance_assets")
    op.drop_table("finance_accounts")
