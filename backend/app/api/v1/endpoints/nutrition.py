from datetime import date
from uuid import UUID

from anyio import to_thread
from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from starlette.datastructures import UploadFile

from app.auth.services.sessions import AuthenticatedSession
from app.core.config import Settings
from app.core.errors import ValidationError
from app.core.middleware import IMMUTABLE_CACHE
from app.dependencies.auth import get_current_session
from app.dependencies.config import get_settings
from app.dependencies.database import get_db
from app.dependencies.storage import get_storage
from app.nutrition.ai import (
    NutritionRuns,
    Pending,
    generate_picture,
    prepare_estimate,
    prepare_target,
)
from app.nutrition.photos import store_photo
from app.nutrition.schemas import (
    DaySummary,
    EstimateInput,
    MealFields,
    MealResponse,
    MealUpdate,
    NutritionState,
    ProfileFields,
    ProfileResponse,
    SavedMealFields,
    SavedMealResponse,
    SavedMealUpdate,
    TargetFields,
    TargetRequest,
    TargetResponse,
    TrainingSummary,
    WeighInInput,
    WeighInResponse,
)
from app.nutrition.service import NutritionService
from app.storage.base import FileStorage

router = APIRouter(prefix="/nutrition", tags=["nutrition"])
ai_router = APIRouter(prefix="/ai/nutrition", tags=["nutrition"])
STREAM_HEADERS = {"Cache-Control": "no-store", "X-Accel-Buffering": "no"}


class PhotoResponse(BaseModel):
    id: UUID
    width: int
    height: int


@router.get("", response_model=NutritionState)
def state(
    db: Session = Depends(get_db), current: AuthenticatedSession = Depends(get_current_session)
) -> NutritionState:
    return NutritionService(db).state(current.user.id)


@router.put("/profile", response_model=ProfileResponse)
def save_profile(
    data: ProfileFields,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> ProfileResponse:
    profile = NutritionService(db).save_profile(current.user.id, data)
    db.commit()
    return ProfileResponse.model_validate(profile, from_attributes=True)


@router.get("/training", response_model=TrainingSummary)
def training(
    db: Session = Depends(get_db), current: AuthenticatedSession = Depends(get_current_session)
) -> TrainingSummary:
    return NutritionService(db).training(current.user.id)


@router.put("/target", response_model=TargetResponse)
def accept_target(
    data: TargetFields,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> TargetResponse:
    target = NutritionService(db).accept_target(current.user.id, data)
    db.commit()
    return TargetResponse.model_validate(target)


@router.get("/days", response_model=list[DaySummary])
def days(
    start: date,
    end: date,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> list[DaySummary]:
    return NutritionService(db).days(current.user.id, start, end)


@router.get("/meals", response_model=list[MealResponse])
def meals(
    start: date,
    end: date,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> list[MealResponse]:
    return NutritionService(db).meals(current.user.id, start, end)


@router.post("/meals", response_model=MealResponse, status_code=201)
def add_meal(
    data: MealFields,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> MealResponse:
    service = NutritionService(db)
    meal = service.add_meal(current.user.id, data)
    db.commit()
    return service.response(meal)


@router.put("/meals/{meal_id}", response_model=MealResponse)
def edit_meal(
    meal_id: UUID,
    data: MealUpdate,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> MealResponse:
    service = NutritionService(db)
    meal = service.edit_meal(current.user.id, meal_id, data)
    db.commit()
    return service.response(meal)


@router.delete("/meals/{meal_id}", status_code=204)
async def remove_meal(
    meal_id: UUID,
    revision: int = Query(ge=1),
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
    storage: FileStorage = Depends(get_storage),
) -> None:
    keys = NutritionService(db).remove_meal(current.user.id, meal_id, revision)
    db.commit()
    for key in keys:
        await storage.delete(key)


@router.post("/saved-meals", response_model=SavedMealResponse, status_code=201)
def add_saved(
    data: SavedMealFields,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> SavedMealResponse:
    saved = NutritionService(db).add_saved(current.user.id, data)
    db.commit()
    return SavedMealResponse.model_validate(saved)


@router.put("/saved-meals/{saved_id}", response_model=SavedMealResponse)
def edit_saved(
    saved_id: UUID,
    data: SavedMealUpdate,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> SavedMealResponse:
    saved = NutritionService(db).edit_saved(current.user.id, saved_id, data)
    db.commit()
    return SavedMealResponse.model_validate(saved)


@router.delete("/saved-meals/{saved_id}", status_code=204)
def remove_saved(
    saved_id: UUID,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> None:
    NutritionService(db).remove_saved(current.user.id, saved_id)
    db.commit()


@router.put("/weigh-ins", response_model=WeighInResponse)
def weigh_in(
    data: WeighInInput,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> WeighInResponse:
    found = NutritionService(db).weigh_in(current.user.id, data)
    db.commit()
    return WeighInResponse.model_validate(found)


@router.delete("/weigh-ins/{day}", status_code=204)
def remove_weigh_in(
    day: date,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> None:
    NutritionService(db).remove_weigh_in(current.user.id, day)
    db.commit()


@router.post("/photos", response_model=PhotoResponse, status_code=201)
async def upload_photo(
    request: Request,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
    storage: FileStorage = Depends(get_storage),
) -> PhotoResponse:
    form = await request.form(max_files=1)
    upload = form.get("file")
    if not isinstance(upload, UploadFile):
        raise ValidationError("Choose a photo of your meal.")
    photo = await store_photo(db, storage, current.user.id, upload)
    db.commit()
    return PhotoResponse(id=photo.id, width=photo.width, height=photo.height)


@router.get("/photos/{photo_id}")
async def photo(
    photo_id: UUID,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
    storage: FileStorage = Depends(get_storage),
) -> StreamingResponse:
    found = NutritionService(db).photo(current.user.id, photo_id)
    return StreamingResponse(
        storage.read(found.storage_key),
        media_type="image/webp",
        headers={"Content-Length": str(found.size), "Cache-Control": IMMUTABLE_CACHE},
    )


def _runs(request: Request, settings: Settings) -> NutritionRuns:
    return NutritionRuns(request.app.state.engine, request.app.state.storage, settings.storage_path)


@ai_router.post("/estimate")
async def estimate(
    data: EstimateInput,
    request: Request,
    settings: Settings = Depends(get_settings),
    current: AuthenticatedSession = Depends(get_current_session),
) -> StreamingResponse:
    def prepare() -> Pending:
        with Session(request.app.state.engine) as db:
            return prepare_estimate(db, settings.storage_path, current.user.id, data)

    pending = await to_thread.run_sync(prepare)
    runs = _runs(request, settings)
    photos = await runs.photos(pending)
    return StreamingResponse(
        runs.estimate(pending, photos), media_type="application/x-ndjson", headers=STREAM_HEADERS
    )


@ai_router.post("/target")
async def propose_target(
    data: TargetRequest,
    request: Request,
    settings: Settings = Depends(get_settings),
    current: AuthenticatedSession = Depends(get_current_session),
) -> StreamingResponse:
    def prepare() -> Pending:
        with Session(request.app.state.engine) as db:
            NutritionService(db).save_profile(current.user.id, data.profile)
            db.commit()
            return prepare_target(db, settings.storage_path, current.user.id, data.profile)

    pending = await to_thread.run_sync(prepare)
    return StreamingResponse(
        _runs(request, settings).target(pending),
        media_type="application/x-ndjson",
        headers=STREAM_HEADERS,
    )


@ai_router.post("/meals/{meal_id}/picture", response_model=PhotoResponse, status_code=201)
async def make_picture(
    meal_id: UUID,
    request: Request,
    settings: Settings = Depends(get_settings),
    current: AuthenticatedSession = Depends(get_current_session),
) -> PhotoResponse:
    photo = await generate_picture(
        request.app.state.engine,
        request.app.state.storage,
        settings.storage_path,
        current.user.id,
        meal_id,
    )
    return PhotoResponse(id=photo.id, width=photo.width, height=photo.height)
