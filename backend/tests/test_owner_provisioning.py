from concurrent.futures import ThreadPoolExecutor

from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from app.auth.models import User
from app.auth.schemas import LoginRequest
from app.auth.services.auth import AuthService
from app.core.errors import ForbiddenError
from tests.conftest import API, TEST_PASSWORD, TEST_SECRET


def test_installer_creates_owner_without_a_browser_setup_secret(
    db: Session, client: TestClient
) -> None:
    credentials = LoginRequest.model_validate({"username": "ilya", "password": TEST_PASSWORD})
    user = AuthService(db).provision_owner(credentials)
    assert user.username == "ilya"
    assert (
        client.post(
            f"{API}/auth/login",
            json=credentials.model_dump(mode="json") | {"password": TEST_PASSWORD},
        ).status_code
        == 200
    )
    assert client.get(f"{API}/auth/status").json()["setup_required"] is False
    assert (
        client.post(
            f"{API}/auth/setup",
            json={"username": "second", "password": TEST_PASSWORD, "setup_secret": TEST_SECRET},
        ).status_code
        == 403
    )


def test_concurrent_provisioning_cannot_replace_an_owner(engine: Engine, db: Session) -> None:
    def provision(username: str) -> bool:
        with Session(engine) as session:
            try:
                AuthService(session).provision_owner(
                    LoginRequest.model_validate(
                        {
                            "username": username,
                            "password": TEST_PASSWORD,
                        }
                    )
                )
                return True
            except ForbiddenError:
                return False

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(provision, ["first", "second"]))
    assert sorted(results) == [False, True]
    assert db.scalar(select(func.count()).select_from(User)) == 1
