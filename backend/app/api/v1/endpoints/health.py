from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.config import API_VERSION, BUILD_COMMIT, SCHEMA_REVISION, VERSION, Settings
from app.dependencies.config import get_settings
from app.dependencies.database import get_db

router = APIRouter(tags=["health"])


@router.get("/health/live")
def liveness() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/health/ready")
def readiness(db: Session = Depends(get_db)) -> JSONResponse:
    try:
        revision = db.scalar(text("SELECT version_num FROM alembic_version"))
    except SQLAlchemyError:
        return JSONResponse({"status": "database_unavailable"}, status_code=503)

    if revision != SCHEMA_REVISION:
        return JSONResponse({"status": "schema_mismatch"}, status_code=503)

    return JSONResponse({"status": "ready", "version": VERSION})


@router.get("/version")
def get_version(settings: Settings = Depends(get_settings)) -> dict[str, str | int]:
    return {
        "version": VERSION,
        "build_commit": BUILD_COMMIT,
        "instance_id": settings.instance_id,
        "api_version": API_VERSION,
        "schema_revision": SCHEMA_REVISION,
    }
