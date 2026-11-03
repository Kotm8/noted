import json
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Event
from unittest.mock import patch
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from app.auth.models import User
from app.auth.services.sessions import SessionService
from app.core.config import Settings
from app.core.security import utc_now
from app.live.watch import WatchSync
from app.notifications.models import PushSubscription
from app.wear.models import WatchDevice
from tests.conftest import API


def watch(engine: Engine, settings: Settings) -> tuple:
    with Session(engine) as db:
        user = db.query(User).one()
        tokens = SessionService(db).create(user, settings, "Test watch")
        db.commit()
        session = SessionService(db).authenticate(tokens.token).session
        device = WatchDevice(session_id=session.id, secret_hash="watch-test-secret")
        db.add(device)
        db.flush()
        subscription = PushSubscription(
            session_id=session.id,
            device_id=device.id,
            kind="mobile",
            endpoint="fcm:noted-test:watch-token",
            keys={},
        )
        db.add(subscription)
        db.commit()
        return user.id, subscription.id, session.id


def test_watch_sync_is_debounced_and_sends_the_last_change_after_a_restart(
    owner: TestClient, engine: Engine
) -> None:
    settings = owner.app.state.settings
    user, _, _ = watch(engine, settings)
    now = utc_now()
    sync = WatchSync(engine, settings)
    with patch("app.live.watch.send_push", return_value="accepted") as send:
        sync.record({user}, now)
        sync.deliver(now)
        assert send.call_count == 1
        assert json.loads(send.call_args.args[3]) == {"kind": "sync"}
        assert send.call_args.kwargs["collapse_key"] == "noted-sync"
        sync.record({user}, now + timedelta(seconds=1))
        sync.record({user}, now + timedelta(seconds=10))
        sync.deliver(now + timedelta(seconds=29))
        assert send.call_count == 1
        restarted = WatchSync(engine, settings)
        restarted.deliver(now + timedelta(seconds=30))
        assert send.call_count == 2
        restarted.deliver(now + timedelta(seconds=60))
        assert send.call_count == 2


def test_watch_sync_workers_cannot_send_the_same_device_concurrently(
    owner: TestClient, engine: Engine
) -> None:
    settings = owner.app.state.settings
    user, _, _ = watch(engine, settings)
    now = utc_now()
    sync = WatchSync(engine, settings)
    sync.record({user}, now)
    entered, release = Event(), Event()

    def push(*args, **kwargs):
        entered.set()
        assert release.wait(5)
        return "accepted"

    with patch("app.live.watch.send_push", side_effect=push) as send, ThreadPoolExecutor(2) as pool:
        first = pool.submit(sync.deliver, now)
        assert entered.wait(5)
        second = pool.submit(WatchSync(engine, settings).deliver, now)
        second.result(timeout=3)
        release.set()
        first.result(timeout=3)
        assert send.call_count == 1


def test_watch_sync_never_targets_another_owner_or_a_revoked_watch(
    owner: TestClient, engine: Engine
) -> None:
    settings = owner.app.state.settings
    user, _, session_id = watch(engine, settings)
    now = utc_now()
    sync = WatchSync(engine, settings)
    with patch("app.live.watch.send_push", return_value="accepted") as send:
        sync.record({uuid4()}, now)
        sync.deliver(now)
        send.assert_not_called()
        sync.record({user}, now)
        assert owner.delete(f"{API}/auth/sessions/{session_id}").status_code == 204
        sync.deliver(now)
        send.assert_not_called()


def test_failed_watch_push_waits_before_retry_and_expired_tokens_are_removed(
    owner: TestClient, engine: Engine
) -> None:
    settings = owner.app.state.settings
    user, subscription, _ = watch(engine, settings)
    now = utc_now()
    sync = WatchSync(engine, settings)
    sync.record({user}, now)
    with patch("app.live.watch.send_push", side_effect=["failed", "expired"]) as send:
        sync.deliver(now)
        sync.deliver(now + timedelta(seconds=29))
        assert send.call_count == 1
        sync.deliver(now + timedelta(seconds=30))
        assert send.call_count == 2
    with Session(engine) as db:
        assert db.get(PushSubscription, subscription) is None
