from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class DocumentUpdate(BaseModel):
    revision: int = Field(ge=0)
    content: str = Field(max_length=200000)


class DocumentResponse(DocumentUpdate):
    model_config = ConfigDict(from_attributes=True)
    channel_id: UUID
    created_at: datetime
    updated_at: datetime
