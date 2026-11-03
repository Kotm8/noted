import asyncio
from contextlib import suppress
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session

from app.auth.cookies import SESSION_COOKIE
from app.auth.services.sessions import SessionService
from app.core.errors import AuthenticationError
from app.core.security import utc_now
from app.live.hub import LiveHub, Peer

router = APIRouter(tags=["live"])


def authenticate(socket: WebSocket) -> tuple[UUID, UUID, datetime]:
    with Session(socket.app.state.engine) as db:
        current = SessionService(db).authenticate(socket.cookies.get(SESSION_COOKIE, ""))
        return current.user.id, current.session.id, current.session.expires_at


@router.websocket("/live")
async def connect(socket: WebSocket) -> None:
    settings = socket.app.state.settings
    if socket.headers.get("origin") != settings.app_origin:
        await socket.close(code=1008)
        return
    if settings.maintenance_path and settings.maintenance_path.exists():
        await socket.close(code=1013)
        return
    try:
        user, session, expires = await asyncio.to_thread(authenticate, socket)
    except AuthenticationError:
        await socket.close(code=1008)
        return
    hub: LiveHub = socket.app.state.live_hubs[asyncio.get_running_loop()]
    try:
        await asyncio.wait_for(hub.ready.wait(), timeout=2)
    except TimeoutError:
        await socket.close(code=1013)
        return
    peer = Peer(user=user, session=session, expires=expires)
    await socket.accept()
    hub.peers.add(peer)
    try:
        await asyncio.to_thread(authenticate, socket)
    except AuthenticationError:
        hub.peers.discard(peer)
        await socket.close(code=1000)
        return
    await socket.send_json({"type": "hello", "server_time": utc_now().isoformat()})

    async def receive() -> None:
        while True:
            message = await socket.receive_text()
            if len(message) > 256:
                await socket.close(code=1009)
                return

    sender = asyncio.create_task(hub.send(socket, peer))
    receiver = asyncio.create_task(receive())
    try:
        await asyncio.wait((sender, receiver), return_when=asyncio.FIRST_COMPLETED)
    finally:
        hub.peers.discard(peer)
        for task in (sender, receiver):
            task.cancel()
            with suppress(asyncio.CancelledError, WebSocketDisconnect, TimeoutError, RuntimeError):
                await task
