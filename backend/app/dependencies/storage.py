from fastapi import Request

from app.storage.base import FileStorage


def get_storage(request: Request) -> FileStorage:
    storage: FileStorage = request.app.state.storage
    return storage
