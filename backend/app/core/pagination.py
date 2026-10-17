import base64
import binascii
import json
from datetime import datetime
from uuid import UUID

from app.core.errors import ValidationError


def encode_message_cursor(created_at: datetime, message_id: UUID) -> str:
    value = json.dumps([created_at.isoformat(), str(message_id)])
    return base64.urlsafe_b64encode(value.encode()).decode()


def decode_message_cursor(cursor: str) -> tuple[datetime, UUID]:
    try:
        if len(cursor) > 256:
            raise ValueError

        created_at, message_id = json.loads(base64.urlsafe_b64decode(cursor))
        timestamp = datetime.fromisoformat(created_at)
        if timestamp.tzinfo is None:
            raise ValueError

        return timestamp, UUID(message_id)
    except (ValueError, TypeError, binascii.Error) as error:
        raise ValidationError("Invalid message cursor") from error
