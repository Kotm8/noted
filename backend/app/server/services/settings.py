from sqlalchemy.orm import Session

from app.auth.models import User
from app.core.config import API_VERSION, SCHEMA_REVISION, VERSION, Settings
from app.server.repository import HealthRepository
from app.server.schemas.settings import ServerSettingsResponse


class ServerService:
    def __init__(self, db: Session) -> None:
        self.health = HealthRepository(db)

    def get_settings(self, settings: Settings, owner: User) -> ServerSettingsResponse:
        revision = self.health.get_schema_revision()
        return ServerSettingsResponse(
            server_name=settings.server_name,
            instance_url=settings.app_origin,
            version=VERSION,
            api_version=API_VERSION,
            schema_revision=revision,
            database_ready=revision == SCHEMA_REVISION,
            owner_username=owner.username,
        )
