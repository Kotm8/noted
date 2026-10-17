from pydantic import BaseModel


class ServerSettingsResponse(BaseModel):
    server_name: str
    instance_url: str
    version: str
    api_version: int
    schema_revision: str | None
    database_ready: bool
    access_mode: str = "owner_only"
    owner_username: str
