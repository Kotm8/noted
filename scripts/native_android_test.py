import argparse
import http.cookiejar
import json
import os
import subprocess
import sys
import tempfile
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path
from urllib.error import URLError
from urllib.request import HTTPCookieProcessor, Request, build_opener, urlopen
from uuid import UUID, uuid4

ROOT = Path(__file__).resolve().parents[1]
ORIGIN = "http://localhost:8123"
PASSWORD = "native-test-password-only"


def seed_extended(engine, client, jar, channels):
    import io

    from PIL import Image
    from sqlalchemy import select
    from sqlalchemy.orm import Session

    from app.ai.assistant.models import AssistantChat, AssistantTurn
    from app.auth.models import User
    from app.journals.models import JournalEntry
    from app.notes.models import Message

    now = datetime.now(UTC)
    with Session(engine) as db:
        owner = db.scalar(select(User).where(User.username == "native"))
        old = now - timedelta(days=5)
        target = Message(
            channel_id=UUID(channels["note"]["id"]),
            author_id=owner.id,
            content="Older search target kept beyond the first page",
            created_at=old,
            updated_at=old,
        )
        db.add(target)
        db.add_all(
            Message(
                channel_id=UUID(channels["note"]["id"]),
                author_id=owner.id,
                content=f"A recent fixture note {index}",
                created_at=now - timedelta(days=2, seconds=index),
                updated_at=now,
            )
            for index in range(205)
        )
        db.add_all(
            JournalEntry(
                channel_id=UUID(channels["journal"]["id"]),
                author_id=owner.id,
                title=f"Recent entry {index}",
                content="Recent journal fixture",
                revision=1,
                created_at=now,
                updated_at=now,
            )
            for index in range(55)
        )
        db.add(
            JournalEntry(
                channel_id=UUID(channels["journal"]["id"]),
                author_id=owner.id,
                title="An older journal entry",
                content="Buried journal content found through search",
                revision=1,
                created_at=old,
                updated_at=old,
            )
        )
        root = db.scalar(
            select(Message).where(
                Message.channel_id == UUID(channels["note"]["id"]),
                Message.content.like("A quiet place%"),
            )
        )
        db.add(
            Message(
                channel_id=root.channel_id,
                author_id=owner.id,
                thread_root_id=root.id,
                content="A thread reply found through search",
                created_at=now,
                updated_at=now,
            )
        )
        chat = AssistantChat(owner_id=owner.id, title="Planning from another device")
        db.add(chat)
        db.flush()
        db.add(
            AssistantTurn(
                chat_id=chat.id,
                owner_id=owner.id,
                role="assistant",
                content="Saved conversation from another device",
                proposal={
                    "explanation": "Saved conversation from another device",
                    "plans": [],
                    "habits": [],
                    "meals": [],
                },
                sources=[],
                photo_ids=[],
                applied=False,
            )
        )
        db.commit()
    image = io.BytesIO()
    Image.new("RGB", (320, 180), (226, 193, 90)).save(image, "PNG")
    animated = io.BytesIO()
    frames = [Image.new("RGB", (180, 100), shade) for shade in [(190, 60, 70), (60, 100, 190)]]
    frames[0].save(animated, "GIF", save_all=True, append_images=frames[1:], duration=250, loop=0)
    for filename, mime, content in [
        ("native-library.png", "image/png", image.getvalue()),
        ("native-animation.gif", "image/gif", animated.getvalue()),
        ("native-video.mp4", "video/mp4", (ROOT / "backend/tests/fixtures/video.mp4").read_bytes()),
    ]:
        boundary = "noted-native-fixture"
        body = (
            (
                f"--{boundary}\r\n"
                'Content-Disposition: form-data; name="content"\r\n\r\n'
                "Media fixture\r\n"
                f"--{boundary}\r\n"
                f'Content-Disposition: form-data; name="files"; filename="{filename}"\r\n'
                f"Content-Type: {mime}\r\n\r\n"
            ).encode()
            + content
            + f"\r\n--{boundary}--\r\n".encode()
        )
        headers = {
            "Origin": ORIGIN,
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "X-CSRF-Token": next(cookie.value for cookie in jar if cookie.name == "noted_csrf"),
        }
        destination = channels["note"] if filename.endswith(".png") else channels["media"]
        with client.open(
            Request(
                ORIGIN + f"/api/v1/channels/{destination['id']}/messages/with-files",
                data=body,
                headers=headers,
            ),
            timeout=20,
        ) as response:
            saved = json.load(response)
        if filename.endswith(".png"):
            with Session(engine) as db:
                message = db.get(Message, UUID(saved["id"]))
                message.created_at = old + timedelta(seconds=1)
                db.commit()


def serve(ready_file: Path, extended: bool = False) -> None:
    from alembic.config import Config
    from sqlalchemy import text
    from sqlalchemy.engine import make_url
    from sqlalchemy.orm import Session

    from alembic import command
    from app.auth.schemas import LoginRequest
    from app.auth.services.auth import AuthService
    from app.db.database import create_database_engine

    base_url = os.environ["NOTED_TEST_DATABASE_URL"]
    schema = f"noted_android_{uuid4().hex}"
    admin = create_database_engine(base_url)
    with admin.begin() as connection:
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    url = make_url(base_url).update_query_dict({"options": f"-csearch_path={schema}"})
    engine = create_database_engine(url.render_as_string(hide_password=False))
    server = None
    storage = tempfile.TemporaryDirectory(prefix="native-android-", dir=ROOT / ".local")
    try:
        config = Config(str(ROOT / "backend/alembic.ini"))
        with engine.begin() as connection:
            config.attributes["connection"] = connection
            command.upgrade(config, "head")
        with Session(engine) as db:
            AuthService(db).provision_owner(LoginRequest(username="native", password=PASSWORD))
        environment = os.environ.copy()
        environment.update(
            NOTED_DATABASE_URL=url.render_as_string(hide_password=False),
            NOTED_APP_ORIGIN=ORIGIN,
            NOTED_COOKIE_SECURE="false",
            NOTED_BACKGROUND_WORKER="false",
            NOTED_STORAGE_PATH=storage.name,
            NOTED_LOGIN_ATTEMPTS_PER_MINUTE="1000",
        )
        server = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "uvicorn",
                "app.main:create_app",
                "--factory",
                "--host",
                "127.0.0.1",
                "--port",
                "8123",
                "--no-access-log",
            ],
            cwd=ROOT / "backend",
            env=environment,
        )
        for _ in range(100):
            if server.poll() is not None:
                raise RuntimeError("The disposable Android test server stopped.")
            try:
                with urlopen(ORIGIN + "/api/v1/health/ready", timeout=1) as response:
                    if response.status == 200:
                        break
            except (URLError, TimeoutError):
                time.sleep(0.2)
        else:
            raise RuntimeError("The disposable Android test server did not start.")
        jar = http.cookiejar.CookieJar()
        client = build_opener(HTTPCookieProcessor(jar))

        def request(path: str, body: dict | None = None, method: str | None = None):
            headers = {"Origin": ORIGIN, "Content-Type": "application/json"}
            headers["X-CSRF-Token"] = next(
                (cookie.value for cookie in jar if cookie.name == "noted_csrf"), ""
            )
            data = json.dumps(body).encode() if body is not None else None
            with client.open(
                Request(ORIGIN + "/api/v1" + path, data=data, headers=headers, method=method),
                timeout=20,
            ) as response:
                raw = response.read()
                return json.loads(raw) if raw else None

        request("/auth/login", {"username": "native", "password": PASSWORD})
        project = request("/workspaces", {"name": "Personal", "icon": "N", "position": 0})
        channels = {}
        for position, (kind, name) in enumerate(
            [
                ("note", "little-thoughts"),
                ("tasks", "tasks"),
                ("journal", "journal"),
                ("document", "notes"),
                ("reminder", "reminders"),
            ]
        ):
            channels[kind] = request(
                f"/workspaces/{project['id']}/channels",
                {"name": name, "kind": kind, "position": position, "category_id": None},
            )
        messages = []
        for content in [
            "A quiet place for the things worth keeping.",
            "**Native Android**, connected straight to your server.",
            "- [ ] Take a walk\n- [x] Make something useful",
        ]:
            messages.append(
                request(f"/channels/{channels['note']['id']}/messages", {"content": content})
            )
        request(
            f"/messages/{messages[0]['id']}/thread",
            {"content": "And a thought that belongs underneath."},
        )
        request(f"/channels/{channels['tasks']['id']}/messages", {"content": "Try the native app"})
        entry = request(
            f"/channels/{channels['journal']['id']}/journal", {"title": "A fresh start"}
        )
        request(
            f"/journal/{entry['id']}",
            {
                "title": entry["title"],
                "content": "# A fresh start\n\nA little space to think.\n\n"
                "- [ ] Write one thing worth remembering",
                "revision": entry["revision"],
            },
            "PUT",
        )
        request(
            f"/channels/{channels['document']['id']}/document",
            {
                "content": "# Notes\n\nYour Markdown, without a browser.\n\n- [ ] Keep it simple",
                "revision": 0,
            },
            "PUT",
        )
        study = request(
            "/time-tracking/activities",
            {"name": "Studying", "icon": "BookOpen", "color": "#9db9ce"},
        )
        request(
            "/time-tracking/activities", {"name": "Working", "icon": "Code2", "color": "#e2c15a"}
        )
        tracker = request("/time-tracking/tracker")
        request(
            "/time-tracking/tracker",
            {
                "action": "start",
                "activity_id": study["id"],
                "revision": tracker["revision"],
                "request_id": str(uuid4()),
            },
        )
        now = datetime.now(UTC)
        for name, kind, goal, period in [
            ("A little reading", "check", 1, "Morning"),
            ("Drink water", "count", 8, "Anytime"),
        ]:
            request(
                "/habits",
                {
                    "name": name,
                    "kind": kind,
                    "goal": goal,
                    "unit": "glasses" if kind == "count" else "times",
                    "period": period,
                    "starts_on": now.date().isoformat(),
                    "timezone": "UTC",
                },
            )
        tomorrow = now.date() + timedelta(days=1)
        request(
            "/schedule/plans",
            {
                "activity_id": study["id"],
                "title": "Make room to learn",
                "date": tomorrow.isoformat(),
                "start_minute": 600,
                "end_minute": 660,
                "timezone": "UTC",
                "frequency": "none",
                "weekdays": [],
                "repeat_until": None,
            },
        )
        request(
            "/templates/notes",
            {
                "name": "Daily reflection",
                "content": "## What went well?\n\n## What comes next?\n\n- [ ] One small step",
            },
        )
        request(
            "/settings/appearance",
            {"preset": "modern", "accent": "#e2c15a", "messageLayout": "minute"},
            "PUT",
        )
        if extended:
            channels["media"] = request(
                f"/workspaces/{project['id']}/channels",
                {"name": "media", "kind": "note", "position": 5, "category_id": None},
            )
            seed_extended(engine, client, jar, channels)
        ready_file.write_text(
            json.dumps(
                {"origin": ORIGIN, "username": "native", "password": PASSWORD, "channels": channels}
            ),
            encoding="utf-8",
        )
        print("Disposable native Android server ready at " + ORIGIN, flush=True)
        server.wait()
    finally:
        if server is not None and server.poll() is None:
            server.terminate()
            try:
                server.wait(timeout=10)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait()
        ready_file.unlink(missing_ok=True)
        engine.dispose()
        if Path(storage.name).resolve().is_relative_to((ROOT / ".local").resolve()):
            storage.cleanup()
        with admin.begin() as connection:
            connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Run the native phone client against a disposable Noted server."
    )
    parser.add_argument("--serve", action="store_true")
    parser.add_argument("--extended", action="store_true")
    parser.add_argument("--fixture", default=str(ROOT / ".local/native-android-fixture.json"))
    args = parser.parse_args()
    sys.path.insert(0, str(ROOT / "backend"))
    serve(Path(args.fixture), args.extended)


if __name__ == "__main__":
    main()
