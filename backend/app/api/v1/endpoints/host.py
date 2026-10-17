from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.auth.services.sessions import AuthenticatedSession
from app.core.config import Settings
from app.core.errors import ConflictError
from app.dependencies.auth import get_current_session
from app.dependencies.config import get_settings
from app.dependencies.database import get_db
from app.server.schemas.host import (
    DomainRequest,
    HostJob,
    HostProbe,
    HostStatus,
    OwnerConfirmation,
    RemoveServer,
    TransferRequest,
)
from app.server.services.host import HostService

router = APIRouter(prefix="/host", tags=["host"])


def get_host_service(
    db: Session = Depends(get_db), settings: Settings = Depends(get_settings)
) -> HostService:
    return HostService(db, settings)


@router.get("/status", response_model=HostStatus)
def host_status(
    current: AuthenticatedSession = Depends(get_current_session),
    service: HostService = Depends(get_host_service),
) -> HostStatus:
    return service.status()


@router.post("/probe", response_model=HostJob, status_code=202)
def probe_host(
    data: HostProbe,
    current: AuthenticatedSession = Depends(get_current_session),
    service: HostService = Depends(get_host_service),
) -> HostJob:
    return service.enqueue("probe", data.model_dump())


def confirmed_request(
    data: OwnerConfirmation,
    action: str,
    request: Request,
    current: AuthenticatedSession,
    service: HostService,
) -> HostJob:
    service.confirm_owner(data, current.user, request.client.host if request.client else "unknown")
    values = data.model_dump(exclude={"current_password"})
    if isinstance(data, TransferRequest):
        values["ssh_password"] = data.ssh_password.get_secret_value()
        values["owner_password"] = data.owner_password.get_secret_value()
    return service.enqueue(action, values)


@router.post("/transfer", response_model=HostJob, status_code=202)
def transfer_host(
    data: TransferRequest,
    request: Request,
    current: AuthenticatedSession = Depends(get_current_session),
    service: HostService = Depends(get_host_service),
) -> HostJob:
    return confirmed_request(data, "transfer", request, current, service)


@router.post("/domain", response_model=HostJob, status_code=202)
def switch_domain(
    data: DomainRequest,
    request: Request,
    current: AuthenticatedSession = Depends(get_current_session),
    service: HostService = Depends(get_host_service),
) -> HostJob:
    return confirmed_request(data, "domain", request, current, service)


@router.post("/remove", response_model=HostJob, status_code=202)
def remove_host(
    data: RemoveServer,
    request: Request,
    current: AuthenticatedSession = Depends(get_current_session),
    service: HostService = Depends(get_host_service),
) -> HostJob:
    if data.instance_id != service.settings.instance_id:
        raise ConflictError(
            "This is a different server instance. Reload before confirming deletion."
        )
    return confirmed_request(data, "remove", request, current, service)


@router.post("/cancel-transfer", response_model=HostJob, status_code=202)
def cancel_transfer(
    data: OwnerConfirmation,
    request: Request,
    current: AuthenticatedSession = Depends(get_current_session),
    service: HostService = Depends(get_host_service),
) -> HostJob:
    return confirmed_request(data, "cancel", request, current, service)
