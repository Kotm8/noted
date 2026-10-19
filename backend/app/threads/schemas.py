from pydantic import BaseModel

from app.notes.schemas import MessagePage, MessageResponse


class ThreadPage(BaseModel):
    root: MessageResponse
    replies: MessagePage
