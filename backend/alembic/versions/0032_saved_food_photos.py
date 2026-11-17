import sqlalchemy as sa

from alembic import op

revision = "0032_saved_food_photos"
down_revision = "0031_assistant_chats"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "saved_meal_photos",
        sa.Column(
            "saved_meal_id",
            sa.UUID(),
            sa.ForeignKey("saved_meals.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "photo_id",
            sa.UUID(),
            sa.ForeignKey("meal_photos.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "owner_id", sa.UUID(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("position", sa.Integer(), nullable=False),
    )
    op.create_index("ix_saved_meal_photos_photo", "saved_meal_photos", ["photo_id"])

    op.execute("""
        WITH pictured AS (
            SELECT DISTINCT ON (s.id) s.id AS saved_id, s.owner_id, m.id AS meal_id
            FROM saved_meals s
            JOIN meals m ON m.owner_id = s.owner_id AND (
                m.saved_meal_id = s.id OR (
                    m.saved_meal_id IS NULL AND lower(m.name) = lower(s.name)
                )
            )
            JOIN meal_photos p ON p.meal_id = m.id AND p.owner_id = s.owner_id
            ORDER BY s.id, m.created_at DESC, m.id
        ), ranked AS (
            SELECT pictured.saved_id, p.id, pictured.owner_id,
                row_number() OVER (
                    PARTITION BY pictured.saved_id ORDER BY p.created_at, p.id
                ) - 1 AS position
            FROM pictured JOIN meal_photos p ON p.meal_id = pictured.meal_id
                AND p.owner_id = pictured.owner_id
        )
        INSERT INTO saved_meal_photos (saved_meal_id, photo_id, owner_id, position)
        SELECT saved_id, id, owner_id, position FROM ranked WHERE position < 4
    """)


def downgrade() -> None:
    op.drop_table("saved_meal_photos")
