import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Workspace(Base):
    __tablename__ = "workspaces"
    __table_args__ = (CheckConstraint("position >= 0"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(80))
    icon: Mapped[str] = mapped_column(String(8), default="✦")
    icon_storage_key: Mapped[str | None] = mapped_column(String(96))
    icon_content_type: Mapped[str | None] = mapped_column(String(100))
    icon_size: Mapped[int | None]
    position: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Category(Base):
    __tablename__ = "categories"
    __table_args__ = (
        UniqueConstraint("id", "workspace_id"),
        CheckConstraint("position >= 0"),
        Index("ix_categories_workspace_position", "workspace_id", "position"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(80))
    position: Mapped[int] = mapped_column(Integer, default=0)


class Channel(Base):
    __tablename__ = "channels"
    __table_args__ = (
        ForeignKeyConstraint(
            ["category_id", "workspace_id"],
            ["categories.id", "categories.workspace_id"],
            ondelete="CASCADE",
        ),
        CheckConstraint("position >= 0"),
        Index("ix_channels_workspace_position", "workspace_id", "position"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    category_id: Mapped[uuid.UUID | None]
    name: Mapped[str] = mapped_column(String(80))
    kind: Mapped[str] = mapped_column(String(16), default="note", server_default="note")
    banner_storage_key: Mapped[str | None] = mapped_column(String(96))
    banner_content_type: Mapped[str | None] = mapped_column(String(100))
    banner_size: Mapped[int | None]
    position: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
