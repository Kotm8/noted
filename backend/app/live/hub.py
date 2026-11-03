import asyncio
import json
import logging
import sys
import threading
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any
from uuid import UUID

import psycopg
from fastapi import WebSocket
from pydantic import ValidationError
from sqlalchemy.engine import Engine, make_url

from app.core.config import Settings
from app.live.changes import CHANNEL
from app.live.topics import LiveEvent
from app.live.watch import SYNC_TOPICS, WatchSync

logger = logging.getLogger(__name__)


@dataclass(eq=False)
class Peer:
    user: UUID
    session: UUID
    expires: datetime
    queue: asyncio.Queue[dict[str, Any] | int] = field(
        default_factory=lambda: asyncio.Queue(maxsize=64)
    )


class LiveHub:
    def __init__(self, settings: Settings, engine: Engine) -> None:
        self.settings = settings
        self.peers: set[Peer] = set()
        self.ready = asyncio.Event()
        self.stopping = threading.Event()
        self.loop: asyncio.AbstractEventLoop | None = None
        self.task: asyncio.Task[None] | None = None
        self.thread: threading.Thread | None = None
        self.watch = WatchSync(engine, settings)
        self.watch_task: asyncio.Task[None] | None = None

    def start(self) -> None:
        self.loop = asyncio.get_running_loop()
        if self.settings.background_worker:
            self.watch_task = asyncio.create_task(self.watch.run())
        if sys.platform == "win32":
            self.thread = threading.Thread(target=self._windows_listener, daemon=True)
            self.thread.start()
        else:
            self.task = asyncio.create_task(self.listen())

    def _windows_listener(self) -> None:
        """Psycopg needs a selector loop; Windows ASGI servers may use a proactor."""
        with asyncio.Runner(loop_factory=asyncio.SelectorEventLoop) as runner:
            runner.run(self.listen())

    async def stop(self) -> None:
        self.stopping.set()
        self.unavailable(1001)
        if self.watch_task:
            self.watch_task.cancel()
            try:
                await self.watch_task
            except asyncio.CancelledError:
                pass
        if self.task:
            self.task.cancel()
            try:
                await self.task
            except asyncio.CancelledError:
                pass
        if self.thread:
            await asyncio.to_thread(self.thread.join, 7)

    def unavailable(self, code: int = 1012) -> None:
        self.ready.clear()
        for peer in list(self.peers):
            self.close(peer, code)

    def available(self) -> None:
        self.watch.catch_up = True
        self.ready.set()

    def close(self, peer: Peer, code: int) -> None:
        self.peers.discard(peer)
        while not peer.queue.empty():
            peer.queue.get_nowait()
        peer.queue.put_nowait(code)

    def dispatch(self, event: LiveEvent) -> None:
        if event.topic in SYNC_TOPICS:
            self.watch.pending.add(event.user)
        for peer in list(self.peers):
            if peer.user != event.user:
                continue
            if event.topic == "sessions" and event.revoked and event.session == peer.session:
                self.close(peer, 1000)
            else:
                try:
                    peer.queue.put_nowait(event.payload())
                except asyncio.QueueFull:
                    self.close(peer, 1013)

    def on_loop(self, callback: Any, *args: Any) -> None:
        if self.loop and not self.loop.is_closed():
            self.loop.call_soon_threadsafe(callback, *args)

    async def listen(self) -> None:
        url = make_url(self.settings.database_url)
        parameters = url.translate_connect_args(username="user", database="dbname")
        parameters.update(url.query)
        delay = 1
        reported = False
        while not self.stopping.is_set():
            try:
                async with await psycopg.AsyncConnection.connect(
                    **parameters, autocommit=True, connect_timeout=5
                ) as connection:
                    cursor = await connection.execute("SELECT current_schema()")
                    row = await cursor.fetchone()
                    schema = row[0] if row else None
                    await connection.execute(f"LISTEN {CHANNEL}")
                    self.on_loop(self.available)
                    delay = 1
                    reported = False
                    while not self.stopping.is_set():
                        async for notification in connection.notifies(timeout=1):
                            try:
                                payload = json.loads(notification.payload)
                                if payload.pop("schema", None) != schema:
                                    continue
                                event = LiveEvent.model_validate(payload)
                            except (ValueError, TypeError, AttributeError, ValidationError):
                                continue
                            self.on_loop(self.dispatch, event)
            except (psycopg.Error, OSError):
                self.on_loop(self.unavailable)
                if not reported:
                    logger.warning("Live updates disconnected from PostgreSQL; reconnecting.")
                    reported = True
                for _ in range(delay * 5):
                    if self.stopping.is_set():
                        return
                    await asyncio.sleep(0.2)
                delay = min(30, delay * 2)

    async def send(self, socket: WebSocket, peer: Peer) -> None:
        while True:
            try:
                item = await asyncio.wait_for(peer.queue.get(), timeout=30)
            except TimeoutError:
                from app.core.security import utc_now

                maintenance = self.settings.maintenance_path
                if utc_now() >= peer.expires or (maintenance and maintenance.exists()):
                    await socket.close(code=1000)
                    return
                item = {"type": "ping"}
            if isinstance(item, int):
                await socket.close(code=item)
                return
            await asyncio.wait_for(socket.send_json(item), timeout=5)
