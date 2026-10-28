import asyncio
import tempfile
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import FastAPI
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.api.v1.router import router
from app.backup.services.cache import BackupCache
from app.core.config import VERSION, Settings
from app.core.exception_handlers import register_exception_handlers
from app.core.middleware import (
    OriginProtectionMiddleware,
    RequestSizeMiddleware,
    SecurityHeadersMiddleware,
)
from app.db.database import create_database_engine
from app.storage.local import LocalFileStorage
from app.worker import background_worker


def build_application(settings: Settings) -> FastAPI:
    engine = create_database_engine(settings.database_url)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        worker = (
            asyncio.create_task(background_worker(engine, settings))
            if settings.background_worker
            else None
        )
        try:
            yield
        finally:
            if worker:
                worker.cancel()
                with suppress(asyncio.CancelledError):
                    await worker
            engine.dispose()

    app = FastAPI(title="Noted API", version=VERSION, lifespan=lifespan)
    app.state.settings = settings
    app.state.engine = engine
    app.state.storage = LocalFileStorage(settings.storage_path)
    app.state.backups = BackupCache(
        settings.backup_path or Path(tempfile.gettempdir()) / "noted-backups"
    )

    app.add_middleware(RequestSizeMiddleware)
    app.add_middleware(OriginProtectionMiddleware, allowed_origin=settings.app_origin)
    app.add_middleware(
        TrustedHostMiddleware,
        allowed_hosts=[
            urlsplit(settings.app_origin).hostname or "localhost",
            "localhost",
            "127.0.0.1",
            "backend",
        ],
    )
    app.add_middleware(SecurityHeadersMiddleware)

    register_exception_handlers(app)
    app.include_router(router)
    return app
