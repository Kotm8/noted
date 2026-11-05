from typing import Literal
from uuid import UUID

from pydantic import BaseModel

NoteKind = Literal["message", "journal", "document"]
IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
MAX_IMAGES = 8


class NoteSource(BaseModel):
    id: UUID
    kind: NoteKind
    title: str
    url: str


class AttachedImage(BaseModel):
    id: UUID
    name: str
    message_number: int
