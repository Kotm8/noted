from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.auth.services.sessions import AuthenticatedSession
from app.dependencies.auth import get_current_session
from app.dependencies.database import get_db
from app.workspaces.models import Category
from app.workspaces.schemas import CategoryCreate, CategoryResponse
from app.workspaces.services.categories import CategoryService

router = APIRouter(tags=["categories"])


@router.get("/workspaces/{workspace_id}/categories", response_model=list[CategoryResponse])
def list_categories(
    workspace_id: UUID,
    limit: int = Query(default=100, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> list[Category]:
    return CategoryService(db).list_categories(workspace_id, current.user.id, limit, offset)


@router.post(
    "/workspaces/{workspace_id}/categories", response_model=CategoryResponse, status_code=201
)
def create_category(
    workspace_id: UUID,
    data: CategoryCreate,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> Category:
    return CategoryService(db).create_category(workspace_id, data, current.user.id)


@router.put("/categories/{category_id}", response_model=CategoryResponse)
def update_category(
    category_id: UUID,
    data: CategoryCreate,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> Category:
    return CategoryService(db).update_category(category_id, data, current.user.id)


@router.delete("/categories/{category_id}", status_code=204)
def delete_category(
    category_id: UUID,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> None:
    CategoryService(db).delete_category(category_id, current.user.id)
