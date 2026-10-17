from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.storage_limits import MAX_ARCHIVE, MAX_BATCH_SIZE, MAX_ICON_SIZE


class RequestSizeMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request = Request(scope)
        path = request.url.path
        maximum = 1024 * 1024
        if path == "/api/v1/backups/preview":
            maximum = MAX_ARCHIVE
        elif path.endswith("/messages/with-files"):
            maximum = MAX_BATCH_SIZE + 2 * 1024 * 1024
        elif path.endswith(("/icon", "/banner")):
            maximum = MAX_ICON_SIZE + 1024 * 1024

        content_length = request.headers.get("content-length")
        if content_length:
            try:
                length = int(content_length)
                if length < 0:
                    raise ValueError
            except ValueError:
                await JSONResponse({"detail": "Invalid content length"}, status_code=400)(
                    scope, receive, send
                )
                return
            if length > maximum:
                await JSONResponse({"detail": "The upload is too large"}, status_code=413)(
                    scope, receive, send
                )
                return

        received = 0

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > maximum:
                    raise HTTPException(status_code=413, detail="The upload is too large")
            return message

        await self.app(scope, limited_receive, send)


class OriginProtectionMiddleware:
    def __init__(self, app: ASGIApp, allowed_origin: str) -> None:
        self.app = app
        self.allowed_origin = allowed_origin

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http":
            request = Request(scope)
            is_write_request = request.method not in {"GET", "HEAD", "OPTIONS"}
            trusted_origin = request.headers.get("origin") == self.allowed_origin

            if is_write_request and not trusted_origin:
                response = JSONResponse({"detail": "Untrusted request origin"}, status_code=403)
                await response(scope, receive, send)
                return

        await self.app(scope, receive, send)


class SecurityHeadersMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                headers.extend(
                    [
                        (b"cache-control", b"no-store"),
                        (b"x-content-type-options", b"nosniff"),
                        (b"referrer-policy", b"same-origin"),
                    ]
                )
                message["headers"] = headers
            await send(message)

        await self.app(scope, receive, send_with_headers)
