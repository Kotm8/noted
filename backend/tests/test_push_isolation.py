from datetime import timedelta
from uuid import uuid4

import pytest
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import text, update
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from alembic import command
from app.application import build_application
from app.auth.models import Installation
from app.core.config import Settings
from app.core.security import hash_token, utc_now
from app.db.database import create_database_engine
from app.notifications.worker import dispatch_due
from app.reminders.models import Reminder
from tests.conftest import API, TEST_ORIGIN, TEST_PASSWORD, TEST_SECRET
from tests.test_reminders import create, subscribe


@pytest.fixture
def other_server(database_url, tmp_path):
    schema = f"noted_other_server_{uuid4().hex}"
    administrator = create_database_engine(database_url)
    with administrator.begin() as connection:
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    url = make_url(database_url).update_query_dict({"options": f"-csearch_path={schema}"})
    isolated_url = url.render_as_string(hide_password=False)
    engine = create_database_engine(isolated_url)
    try:
        config = Config("alembic.ini")
        with engine.begin() as connection:
            config.attributes["connection"] = connection
            command.upgrade(config, "head")
        with Session(engine) as db:
            db.add(Installation(id=1, secret_hash=hash_token(TEST_SECRET)))
            db.commit()
        app = build_application(
            Settings(
                database_url=isolated_url,
                app_origin=TEST_ORIGIN,
                cookie_secure=False,
                storage_path=tmp_path / "other-server-files",
                backup_path=tmp_path / "other-backups",
            )
        )
        with TestClient(
            app, base_url="http://localhost", headers={"Origin": TEST_ORIGIN}
        ) as client:
            response = client.post(
                f"{API}/auth/setup",
                json={
                    "username": "other-owner",
                    "password": TEST_PASSWORD,
                    "setup_secret": TEST_SECRET,
                },
            )
            assert response.status_code == 201
            client.headers["X-CSRF-Token"] = client.cookies["noted_csrf"]
            yield client, engine
    finally:
        engine.dispose()
        with administrator.begin() as connection:
            connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        administrator.dispose()


def test_servers_have_independent_push_keys_devices_and_presence(
    owner, channel, db, other_server, monkeypatch
):
    other, other_engine = other_server
    first_key = owner.get(f"{API}/notifications/config").json()
    second_key = other.get(f"{API}/notifications/config").json()
    assert set(first_key) == set(second_key) == {"public_key"}
    assert first_key != second_key
    assert owner.get(f"{API}/notifications/config").json() == first_key

    desktop = subscribe(owner)
    first_phone = subscribe(owner, "mobile")
    phone = subscribe(other, "mobile")
    owner.post(
        f"{API}/notifications/presence",
        json={
            "device_id": desktop["device_id"],
            "kind": "desktop",
            "focused": True,
        },
    )
    project = other.post(f"{API}/workspaces", json={"name": "Other server"}).json()
    other_channel = other.post(
        f"{API}/workspaces/{project['id']}/channels",
        json={
            "name": "private-reminders",
        },
    ).json()
    first_note = create(owner, channel)
    second_note = create(other, other_channel)
    db.execute(update(Reminder).values(due_at=utc_now() - timedelta(seconds=1)))
    db.commit()
    with Session(other_engine) as second_db:
        second_db.execute(update(Reminder).values(due_at=utc_now() - timedelta(seconds=1)))
        second_db.commit()

    deliveries = []

    def send(**values):
        deliveries.append(values)

    monkeypatch.setattr("pywebpush.webpush", send)
    dispatch_due(db.get_bind(), "https://first.example.com")
    assert len(deliveries) == 1
    assert deliveries[0]["subscription_info"]["endpoint"] == desktop["endpoint"]
    assert first_note["id"] in deliveries[0]["data"]
    assert second_note["id"] not in deliveries[0]["data"]
    dispatch_due(other_engine, "https://second.example.com")
    assert len(deliveries) == 2
    assert deliveries[1]["subscription_info"]["endpoint"] == phone["endpoint"]
    assert second_note["id"] in deliveries[1]["data"]
    assert first_note["id"] not in deliveries[1]["data"]
    assert deliveries[0]["vapid_private_key"] != deliveries[1]["vapid_private_key"]
    dispatch_due(db.get_bind(), "https://first.example.com")
    dispatch_due(other_engine, "https://second.example.com")
    assert len(deliveries) == 2
    deliveries.clear()
    assert owner.post(f"{API}/notifications/test").json()["accepted"] == 1
    assert len(deliveries) == 1
    assert deliveries[0]["subscription_info"]["endpoint"] == first_phone["endpoint"]
    assert other.post(f"{API}/notifications/test").json()["accepted"] == 1
    assert len(deliveries) == 2
    assert deliveries[1]["subscription_info"]["endpoint"] == phone["endpoint"]
