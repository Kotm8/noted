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
from app.live.hub import LiveHub
from app.notes.images.worker import image_preview_worker
from app.storage.local import LocalFileStorage
from app.worker import background_worker


def build_application(settings: Settings) -> FastAPI:
    engine = create_database_engine(settings.database_url)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        loop = asyncio.get_running_loop()
        live = LiveHub(settings, engine)
        app.state.live_hubs[loop] = live
        live.start()
        worker = (
            asyncio.create_task(background_worker(engine, settings))
            if settings.background_worker
            else None
        )
        previews = (
            asyncio.create_task(image_preview_worker(engine, app.state.storage, settings))
            if settings.background_worker
            else None
        )
        try:
            yield
        finally:
            await live.stop()
            app.state.live_hubs.pop(loop, None)
            if worker:
                worker.cancel()
                with suppress(asyncio.CancelledError):
                    await worker
            if previews:
                previews.cancel()
                with suppress(asyncio.CancelledError):
                    await previews
            engine.dispose()

    app = FastAPI(title="Noted API", version=VERSION, lifespan=lifespan)
    app.state.settings = settings
    app.state.engine = engine
    app.state.live_hubs = {}
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
