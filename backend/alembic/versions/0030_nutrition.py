import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0030_nutrition"
down_revision = "0029_habits"
branch_labels = None
depends_on = None


def _owner() -> sa.Column:
    return sa.Column(
        "owner_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )


def upgrade() -> None:
    op.create_table(
        "nutrition_profiles",
        sa.Column(
            "owner_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("age", sa.Integer(), nullable=False),
        sa.Column("age_given_on", sa.Date(), nullable=False),
        sa.Column("sex", sa.String(12), nullable=False),
        sa.Column("height_cm", sa.Float(), nullable=False),
        sa.Column("weight_kg", sa.Float(), nullable=False),
        sa.Column("activity", sa.String(12), nullable=False),
        sa.Column("goal", sa.String(300), nullable=False),
        sa.Column("pace", sa.String(10), nullable=False),
        sa.Column("pregnant", sa.Boolean(), nullable=False),
        sa.Column("read_training", sa.Boolean(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("sex IN ('male', 'female', 'unspecified')", name="ck_nutrition_sex"),
        sa.CheckConstraint(
            "activity IN ('sedentary', 'light', 'moderate', 'very', 'athlete')",
            name="ck_nutrition_activity",
        ),
    )
    op.create_table(
        "nutrition_targets",
        sa.Column("id", sa.Uuid(), primary_key=True),
        _owner(),
        sa.Column("starts_on", sa.Date(), nullable=False),
        sa.Column("resting", sa.Integer(), nullable=False),
        sa.Column("maintenance", sa.Integer(), nullable=False),
        sa.Column("kcal", sa.Integer(), nullable=False),
        sa.Column("protein", sa.Integer(), nullable=False),
        sa.Column("carbs", sa.Integer(), nullable=False),
        sa.Column("fat", sa.Integer(), nullable=False),
        sa.Column("explanation", sa.Text(), nullable=False),
        sa.Column("sources", postgresql.JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "uq_nutrition_target_day", "nutrition_targets", ["owner_id", "starts_on"], unique=True
    )
    op.create_table(
        "saved_meals",
        sa.Column("id", sa.Uuid(), primary_key=True),
        _owner(),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("items", postgresql.JSONB(), nullable=False),
        sa.Column("uses", sa.Integer(), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True)),
        sa.Column("revision", sa.Integer(), nullable=False),
    )
    op.create_index("ix_saved_meals_owner", "saved_meals", ["owner_id"])
    op.create_table(
        "meals",
        sa.Column("id", sa.Uuid(), primary_key=True),
        _owner(),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("minute", sa.Integer(), nullable=False),
        sa.Column("slot", sa.String(10), nullable=False),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("items", postgresql.JSONB(), nullable=False),
        sa.Column("source", sa.String(8), nullable=False),
        sa.Column("saved_meal_id", sa.Uuid(), sa.ForeignKey("saved_meals.id", ondelete="SET NULL")),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "slot IN ('Breakfast', 'Lunch', 'Dinner', 'Snack')", name="ck_meal_slot"
        ),
        sa.CheckConstraint("minute BETWEEN 0 AND 1439", name="ck_meal_minute"),
    )
    op.create_index("ix_meals_owner_day", "meals", ["owner_id", "day"])
    op.create_table(
        "weigh_ins",
        sa.Column(
            "owner_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("day", sa.Date(), primary_key=True),
        sa.Column("weight_kg", sa.Float(), nullable=False),
    )
    op.create_table(
        "meal_photos",
        sa.Column("id", sa.Uuid(), primary_key=True),
        _owner(),
        sa.Column("meal_id", sa.Uuid(), sa.ForeignKey("meals.id", ondelete="SET NULL")),
        sa.Column("storage_key", sa.String(96), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_meal_photos_owner", "meal_photos", ["owner_id", "created_at"])


def downgrade() -> None:
    op.drop_table("meal_photos")
    op.drop_table("weigh_ins")
    op.drop_table("meals")
    op.drop_table("saved_meals")
    op.drop_table("nutrition_targets")
    op.drop_table("nutrition_profiles")
