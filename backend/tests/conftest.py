import os
from collections.abc import Iterator
from pathlib import Path
from uuid import uuid4

import pytest
from alembic.config import Config
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.orm import Session

from alembic import command
from app.application import build_application
from app.auth.models import Installation
from app.core.config import Settings
from app.core.security import hash_token
from app.db.database import create_database_engine

TEST_SECRET = "a-one-time-secret-for-tests-only"
TEST_PASSWORD = "a-long-password-for-tests-only"
TEST_ORIGIN = "http://localhost:5173"
API = "/api/v1"


@pytest.fixture
def database_url() -> Iterator[str]:
    base_url = os.environ.get("NOTED_TEST_DATABASE_URL")
    if not base_url:
        pytest.fail("Run python scripts/dev.py test to use the local PostgreSQL test database.")

    schema_name = f"noted_test_{uuid4().hex}"
    admin_engine = create_database_engine(base_url)
    with admin_engine.begin() as connection:
        connection.execute(text(f'CREATE SCHEMA "{schema_name}"'))

    url = make_url(base_url).update_query_dict({"options": f"-csearch_path={schema_name}"})
    try:
        yield url.render_as_string(hide_password=False)
    finally:
        with admin_engine.begin() as connection:
            connection.execute(text(f'DROP SCHEMA "{schema_name}" CASCADE'))
        admin_engine.dispose()


@pytest.fixture
def engine(database_url: str) -> Iterator[Engine]:
    engine = create_database_engine(database_url)
    backend_directory = Path(__file__).resolve().parents[1]
    config = Config(str(backend_directory / "alembic.ini"))

    with engine.begin() as connection:
        config.attributes["connection"] = connection
        command.upgrade(config, "head")

    with Session(engine) as db:
        db.add(Installation(id=1, secret_hash=hash_token(TEST_SECRET)))
        db.commit()

    yield engine
    engine.dispose()


@pytest.fixture
def db(engine: Engine) -> Iterator[Session]:
    with Session(engine) as session:
        yield session


@pytest.fixture
def app(database_url: str, engine: Engine, tmp_path: Path) -> FastAPI:
    return build_application(
        Settings(
            database_url=database_url,
            app_origin=TEST_ORIGIN,
            cookie_secure=False,
            storage_path=tmp_path / "attachments",
            backup_path=tmp_path / "backups",
        )
    )


@pytest.fixture
def client(app: FastAPI) -> Iterator[TestClient]:
    with TestClient(app, base_url="http://localhost", headers={"Origin": TEST_ORIGIN}) as client:
        yield client


@pytest.fixture
def owner(client: TestClient) -> TestClient:
    response = client.post(
        f"{API}/auth/setup",
        json={
            "username": "ilya",
            "password": TEST_PASSWORD,
            "setup_secret": TEST_SECRET,
        },
    )
    assert response.status_code == 201
    client.headers["X-CSRF-Token"] = client.cookies["noted_csrf"]
    return client


@pytest.fixture
def channel(owner: TestClient) -> dict[str, str]:
    workspace = owner.post(f"{API}/workspaces", json={"name": "Programming"}).json()
    category = owner.post(
        f"{API}/workspaces/{workspace['id']}/categories",
        json={"name": "Backend"},
    ).json()
    response = owner.post(
        f"{API}/workspaces/{workspace['id']}/channels",
        json={"name": "python", "category_id": category["id"]},
    )
    assert response.status_code == 201
    return response.json()
