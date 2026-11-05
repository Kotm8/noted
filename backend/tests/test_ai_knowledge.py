import json
from datetime import date
from io import BytesIO
from uuid import UUID, uuid4

import pytest
from PIL import Image
from pydantic_ai import ModelRetry
from pydantic_ai.messages import BinaryContent, ToolReturnPart, UserPromptPart
from pydantic_ai.models.function import DeltaToolCall, FunctionModel
from sqlalchemy import func, select

from app.ai.knowledge.tools import NotedKnowledge
from app.ai.runs import RunService
from app.auth.models import User
from app.schedule.models import SchedulePlan
from tests.conftest import API
from tests.test_ai_calendar import setup_calendar


def journal(owner, project_id, content="Read a chapter for one hour."):
    channel = owner.post(
        f"{API}/workspaces/{project_id}/channels", json={"name": "daily", "kind": "journal"}
    ).json()
    entry = owner.post(
        f"{API}/channels/{channel['id']}/journal", json={"title": "Quiet Tuesday"}
    ).json()
    response = owner.put(
        f"{API}/journal/{entry['id']}",
        json={"title": entry["title"], "content": content, "revision": entry["revision"]},
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_knowledge_search_read_pagination_and_ownership(owner, channel, app, db):
    owner_id = db.scalar(select(User.id))
    project_id = owner.get(f"{API}/channels").json()[0]["workspace_id"]
    entry = journal(owner, project_id, "Read chapters\n" * 1000)
    message = owner.post(
        f"{API}/channels/{channel['id']}/messages", json={"content": "Read 100% of my book"}
    ).json()
    removed = owner.post(
        f"{API}/channels/{channel['id']}/messages", json={"content": "Read the deleted note"}
    ).json()
    owner.delete(f"{API}/messages/{removed['id']}")
    tools = NotedKnowledge(
        app.state.engine, app.state.settings.storage_path, owner_id, "Europe/Moscow"
    )
    found = tools.search("Tuesday", kind="journal").return_value
    assert found["total"] == 1 and found["items"][0]["source"]["id"] == entry["id"]
    assert tools.search("Read", kind="message").return_value["total"] == 1
    assert (
        tools.search("%", kind="message").return_value["items"][0]["source"]["id"] == message["id"]
    )
    assert tools.search("Read", channel="missing").return_value["total"] == 0
    assert tools.search("Tuesday", before=date(2000, 1, 1)).return_value["total"] == 0
    read = tools.read("journal", UUID(entry["id"]), limit=100).return_value
    assert read["next_offset"] == 100 and len(read["text"]) == 100
    assert (
        tools.read("journal", UUID(entry["id"]), offset=100, limit=100).return_value["text"]
        == entry["content"][100:200]
    )
    assert "entry=" + entry["id"] in read["source"]["url"]
    denied = NotedKnowledge(app.state.engine, app.state.settings.storage_path, uuid4())
    assert denied.search("Read").return_value["total"] == 0
    with pytest.raises(ModelRetry, match="not found"):
        denied.read("journal", UUID(entry["id"]))
    with pytest.raises(ModelRetry, match="not found"):
        denied.read("message", UUID(message["id"]))
    with pytest.raises(ModelRetry):
        tools.read("message", UUID(removed["id"]))


def test_picture_only_ai_gets_image_bytes_and_preserves_original(
    owner, channel, app, db, monkeypatch
):
    original = BytesIO()
    Image.new("RGB", (3000, 1000), "red").save(original, format="PNG")
    uploaded = owner.post(
        f"{API}/channels/{channel['id']}/messages/with-files",
        files={"files": ("rectangle.png", original.getvalue(), "image/png")},
    )
    assert uploaded.status_code == 201, uploaded.text
    note = uploaded.json()
    attachment = note["attachments"][0]
    seen = []

    async def answer(messages, info):
        images = [
            part
            for message in messages
            for prompt in message.parts
            if isinstance(prompt, UserPromptPart) and isinstance(prompt.content, list)
            for part in prompt.content
            if isinstance(part, BinaryContent)
        ]
        seen.extend(images)
        assert len(images) == 1 and images[0].media_type == "image/webp"
        with Image.open(BytesIO(images[0].data)) as picture:
            assert picture.size == (2048, 683)
        yield "A red rectangle."

    monkeypatch.setattr(RunService, "model", lambda *_: FunctionModel(stream_function=answer))
    response = owner.post(
        f"{API}/ai/runs",
        json={
            "instructions": "What is in this picture?",
            "kind": "answer",
            "message_ids": [note["id"]],
        },
    )
    events = [json.loads(line) for line in response.text.splitlines()]
    assert events[-1]["type"] == "done" and events[-1]["output"] == "A red rectangle.", events
    assert len(seen) == 1
    assert owner.get(attachment["download_url"]).content == original.getvalue()
    owner_id = db.scalar(select(User.id))
    tools = NotedKnowledge(app.state.engine, app.state.settings.storage_path, owner_id)
    viewed = tools.view_image(UUID(attachment["id"]))
    assert viewed.content and isinstance(viewed.content[0], BinaryContent)
    with pytest.raises(ModelRetry, match="not found"):
        NotedKnowledge(app.state.engine, app.state.settings.storage_path, uuid4()).view_image(
            UUID(attachment["id"])
        )


def test_calendar_ai_searches_and_reads_a_journal_before_proposing(owner, db, monkeypatch):
    scope, block = setup_calendar(owner)
    project = owner.post(f"{API}/workspaces", json={"name": "Planning"}).json()
    entry = journal(owner, project["id"])
    called = []

    async def answer(messages, info):
        results = [
            part
            for message in messages
            for part in message.parts
            if isinstance(part, ToolReturnPart)
        ]
        if not results:
            called.append("search")
            yield {
                0: DeltaToolCall(
                    name="search_noted",
                    json_args=json.dumps({"query": "Quiet Tuesday", "kind": "journal"}),
                )
            }
        elif len(results) == 1:
            found = results[0].content
            assert found["items"][0]["source"]["id"] == entry["id"]
            called.append("read")
            yield {
                0: DeltaToolCall(
                    name="read_noted",
                    json_args=json.dumps({"kind": "journal", "identifier": entry["id"]}),
                )
            }
        else:
            assert results[-1].content["text"] == "Read a chapter for one hour."
            called.append("propose")
            yield {
                0: DeltaToolCall(
                    name=info.output_tools[0].name,
                    json_args=json.dumps(
                        {"explanation": "Reading from Quiet Tuesday.", "blocks": [block]}
                    ),
                )
            }

    monkeypatch.setattr(RunService, "model", lambda *_: FunctionModel(stream_function=answer))
    response = owner.post(
        f"{API}/ai/calendar/runs",
        json={**scope, "instructions": "Make a schedule based on Quiet Tuesday in my journal"},
    )
    events = [json.loads(line) for line in response.text.splitlines()]
    assert events[-1]["type"] == "done", events
    assert called == ["search", "read", "propose"]
    assert any(event["type"] == "search" and event.get("scope") == "noted" for event in events)
    assert any(source["url"].endswith("entry=" + entry["id"]) for source in events[-1]["sources"])
    assert db.scalar(select(func.count()).select_from(SchedulePlan)) == 0
    history = owner.get(f"{API}/ai/runs").json()[0]
    assert history["outcome"] == "ready" and history["usage"]["noted_searched"]
