from fastapi import FastAPI

from app.application import build_application
from app.core.config import Settings


def create_app() -> FastAPI:
    return build_application(Settings())
