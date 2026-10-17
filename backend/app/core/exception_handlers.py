from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError

from app.core.errors import ApplicationError, RateLimitError


async def handle_application_error(request: Request, error: Exception) -> JSONResponse:
    if not isinstance(error, ApplicationError):
        raise error

    headers = {"Retry-After": "60"} if isinstance(error, RateLimitError) else None
    return JSONResponse(
        {"detail": error.message},
        status_code=error.status_code,
        headers=headers,
    )


async def handle_validation_error(request: Request, error: Exception) -> JSONResponse:
    if not isinstance(error, RequestValidationError):
        raise error

    details = [{"loc": item["loc"], "msg": item["msg"]} for item in error.errors()]
    return JSONResponse({"detail": details}, status_code=422)


async def handle_database_error(request: Request, error: Exception) -> JSONResponse:
    return JSONResponse(
        {"detail": "The database is unavailable. Try again shortly."},
        status_code=503,
    )


def register_exception_handlers(app: FastAPI) -> None:
    app.add_exception_handler(ApplicationError, handle_application_error)
    app.add_exception_handler(RequestValidationError, handle_validation_error)
    app.add_exception_handler(SQLAlchemyError, handle_database_error)
