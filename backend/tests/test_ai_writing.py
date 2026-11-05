import json
from contextlib import asynccontextmanager
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest
from alembic.config import Config
from fastapi.testclient import TestClient
from pydantic_ai.exceptions import ModelHTTPError
from pydantic_ai.messages import (
    Citation,
    NativeToolCallPart,
    NativeToolReturnPart,
    PartDeltaEvent,
    PartEndEvent,
    PartStartEvent,
    TextPart,
    TextPartDelta,
    ThinkingPart,
    WebCitationSource,
)
from pydantic_ai.models.function import FunctionModel
from pydantic_ai.run import AgentRunResultEvent
from pydantic_ai.usage import RunUsage
from sqlalchemy import select, text
from sqlalchemy.engine import Engine

from alembic import command
from app.ai.context import InputTooLong, check_budget, writing_context
from app.ai.models import AiRun
from app.ai.runs import RunService
from app.ai.schemas import RunInput
from app.ai.streaming import StreamState
from app.auth.models import User
from app.core.errors import NotFoundError
from tests.conftest import API


def sent(response) -> list[dict]:
    assert response.status_code == 200, response.text
    return [json.loads(line) for line in response.text.splitlines() if line]


def writing_channel(owner: TestClient, kind: str) -> dict:
    workspace = owner.post(f"{API}/workspaces", json={"name": "Writing"}).json()
    response = owner.post(
        f"{API}/workspaces/{workspace['id']}/channels",
        json={
            "name": "daily" if kind == "journal" else "draft",
            "kind": kind,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


@pytest.fixture
def local_model(monkeypatch):
    captured = []

    async def answer(messages, info):
        captured.append(messages)
        yield "A grounded answer."

    monkeypatch.setattr(RunService, "model", lambda *_: FunctionModel(stream_function=answer))
    return captured


def test_look_back_checks_entries_and_records_every_source(owner, db, local_model):
    channel = writing_channel(owner, "journal")
    entry = owner.post(f"{API}/channels/{channel['id']}/journal", json={"title": "Tuesday"}).json()
    updated = owner.put(
        f"{API}/journal/{entry['id']}",
        json={
            "title": "Tuesday",
            "content": "A quiet day.",
            "revision": entry["revision"],
        },
    )
    assert updated.status_code == 200
    request = {
        "place": "journals",
        "channel_id": channel["id"],
        "kind": "answer",
        "entry_ids": [entry["id"]],
        "instructions": "Review this week",
    }
    events = sent(owner.post(f"{API}/ai/runs", json=request))
    assert [item["type"] for item in events[:2]] == ["start", "thinking"]
    assert events[-1]["type"] == "done"
    run = owner.get(f"{API}/ai/runs").json()[0]
    assert run["input"][0]["id"] == entry["id"] and run["input"][0]["title"] == "Tuesday"
    assert run["where"] == "Journal · daily · 1 entries"
    assert "Tuesday" in str(local_model[0]) and "A quiet day." in str(local_model[0])
    assert (
        owner.post(f"{API}/ai/runs", json={**request, "entry_ids": [str(uuid4())]}).status_code
        == 404
    )
    assert (
        owner.post(
            f"{API}/ai/runs", json={**request, "entry_ids": [str(uuid4()) for _ in range(61)]}
        ).status_code
        == 422
    )
    assert (
        owner.post(
            f"{API}/ai/runs", json={**request, "entry_ids": [entry["id"], entry["id"]]}
        ).status_code
        == 422
    )
    assert owner.post(f"{API}/ai/runs", json={**request, "kind": "rewrite"}).status_code == 422
    owner_id = db.scalar(select(User.id))
    with pytest.raises(NotFoundError):
        writing_context(db, uuid4(), RunInput.model_validate(request), "answer")
    assert owner_id is not None


def test_conversations_are_scoped_and_work_without_saved_history(owner, local_model):
    channel = writing_channel(owner, "document")
    conversation_id = str(uuid4())
    request = {
        "place": "documents",
        "channel_id": channel["id"],
        "kind": "answer",
        "instructions": "What should I book?",
        "text": "Porto trip",
        "conversation_id": conversation_id,
    }
    sent(owner.post(f"{API}/ai/runs", json=request))
    second = sent(
        owner.post(
            f"{API}/ai/runs",
            json={
                **request,
                "instructions": "And trains?",
                "text": "Porto trip, now with dates",
                "history": [
                    {"role": "user", "content": "What should I book?"},
                    {"role": "assistant", "content": "A hotel."},
                ],
            },
        )
    )
    assert second[-1]["type"] == "done"
    assert "A hotel." in str(local_model[-1]) and "now with dates" in str(local_model[-1])
    listing = owner.get(f"{API}/ai/conversations", params={"channel_id": channel["id"]}).json()
    assert listing[0]["turns"] == 2 and listing[0]["question"] == "What should I book?"
    turns = owner.get(f"{API}/ai/conversations/{conversation_id}").json()
    assert len(turns) == 2 and turns[1]["instructions"] == "And trains?"
    other = writing_channel(owner, "document")
    assert (
        owner.post(f"{API}/ai/runs", json={**request, "channel_id": other["id"]}).status_code == 404
    )
    assert owner.get(f"{API}/ai/conversations/{uuid4()}").status_code == 404
    assert owner.delete(f"{API}/ai/runs/{turns[0]['id']}").status_code == 204
    assert len(owner.get(f"{API}/ai/conversations/{conversation_id}").json()) == 1
    prefs = owner.get(f"{API}/ai/preferences").json()
    owner.put(f"{API}/ai/preferences", json={**prefs, "keep_history": False})
    third = sent(
        owner.post(
            f"{API}/ai/runs",
            json={**request, "history": [{"role": "user", "content": "Earlier question"}]},
        )
    )
    assert third[0]["run_id"] is None and third[-1]["type"] == "done"
    assert "Earlier question" in str(local_model[-1])
    assert len(owner.get(f"{API}/ai/conversations/{conversation_id}").json()) == 1


def test_input_budget_counts_combined_history_and_returns_a_useful_code(owner, local_model):
    channel = writing_channel(owner, "document")
    request = {
        "place": "documents",
        "channel_id": channel["id"],
        "kind": "answer",
        "instructions": "Explain",
        "text": "x" * 150001,
    }
    events = sent(owner.post(f"{API}/ai/runs", json=request))
    assert events[0]["code"] == "too_long" and "30,000 words" in events[0]["message"]
    assert "Select the part" in events[0]["message"]
    assert local_model == []
    with pytest.raises(InputTooLong):
        check_budget("x" * 100000, [{"role": "assistant", "content": "x" * 50000}])
    assert owner.post(f"{API}/ai/runs", json={**request, "kind": "reply"}).status_code == 422


def test_writing_starters_are_only_added_once_for_existing_owners(owner, db):
    owner.get(f"{API}/ai/prompts")
    user = db.scalar(select(User))
    user.ai_preferences = {"starters_added": True}
    db.execute(text("DELETE FROM ai_prompts"))
    db.commit()
    starters = owner.get(f"{API}/ai/prompts").json()
    assert {item["name"] for item in starters} == {
        "Weekly review",
        "What patterns do you see?",
        "Three questions to write about",
        "Outline from a title",
    }
    for item in starters:
        owner.delete(f"{API}/ai/prompts/{item['id']}")
    assert owner.get(f"{API}/ai/prompts").json() == []


def test_search_events_and_citations_are_saved(owner, monkeypatch):
    channel = writing_channel(owner, "document")

    class EventAgent:
        @asynccontextmanager
        async def run_stream_events(self, prompt, **kwargs):
            async def stream():
                yield PartStartEvent(index=0, part=ThinkingPart("Checking bookings"))
                yield PartStartEvent(
                    index=1,
                    part=NativeToolCallPart("web_search", {"query": "Porto trains"}, "search-1"),
                )
                yield PartStartEvent(
                    index=2,
                    part=NativeToolReturnPart(
                        "web_search",
                        {
                            "sources": [
                                {"url": "https://example.com/other", "title": "Other"},
                                {"url": "https://example.com/trains", "title": "Trains"},
                            ]
                        },
                        "search-1",
                    ),
                )
                yield PartStartEvent(index=3, part=TextPart("Take "))
                yield PartDeltaEvent(index=3, delta=TextPartDelta("the train."))
                yield PartEndEvent(
                    index=3,
                    part=TextPart(
                        "Take the train.",
                        citations=[
                            Citation(
                                [
                                    WebCitationSource(
                                        "https://example.com/trains", title="Train times"
                                    ),
                                ]
                            )
                        ],
                    ),
                )
                yield AgentRunResultEvent(
                    SimpleNamespace(
                        output="Take the train.",
                        usage=RunUsage(input_tokens=20, output_tokens=4, cost=Decimal("0.000042")),
                    )
                )

            yield stream()

    monkeypatch.setattr(RunService, "_agent", lambda *_: EventAgent())
    events = sent(
        owner.post(
            f"{API}/ai/runs",
            json={
                "place": "documents",
                "channel_id": channel["id"],
                "kind": "answer",
                "instructions": "What train?",
                "text": "Porto",
            },
        )
    )
    assert any(
        item["type"] == "thinking" and item.get("heading") == "Checking bookings" for item in events
    )
    assert any(item["type"] == "search" and item["query"] == "Porto trains" for item in events)
    sources = events[-1]["sources"]
    assert [item["url"] for item in sources] == [
        "https://example.com/trains",
        "https://example.com/other",
    ]
    run = owner.get(f"{API}/ai/runs").json()[0]
    assert run["usage"]["sources"] == sources and run["usage"]["thought_seconds"] >= 0
    assert events[-1]["type"] == "done" and run["outcome"] == "ready"
    assert run["usage"]["cost"] == "0.000042"
    assert run["usage"]["input_tokens"] == 20 and run["usage"]["output_tokens"] == 4
    state = StreamState()
    state.add_source({"url": "javascript:bad", "title": "No"})
    assert state.sources == []
    state.add_source({"url": "https://example.com/guide.", "title": "Guide"})
    state.add_source({"url": "https://example.com/guide", "title": "Guide"})
    assert state.sources == [{"url": "https://example.com/guide", "title": "Guide"}]


def test_optional_provider_settings_fall_back_without_losing_the_answer(owner, monkeypatch):
    channel = writing_channel(owner, "document")
    attempts = []

    def agent(self, prepared, output):
        attempts.append(prepared.extended_settings)
        if prepared.extended_settings:
            raise ModelHTTPError(400, prepared.model, {"error": "Unsupported reasoning summary"})
        return original_agent(self, prepared, output)

    async def answer(messages, info):
        yield "Still works."

    original_agent = RunService._agent
    monkeypatch.setattr(RunService, "model", lambda *_: FunctionModel(stream_function=answer))
    monkeypatch.setattr(RunService, "_agent", agent)
    events = sent(
        owner.post(
            f"{API}/ai/runs",
            json={
                "place": "documents",
                "channel_id": channel["id"],
                "kind": "answer",
                "instructions": "Help",
                "text": "A draft",
            },
        )
    )
    assert attempts == [True, False]
    assert events[-1]["output"] == "Still works."


@pytest.mark.anyio
async def test_closing_a_stream_marks_its_saved_run_cancelled(owner, app, db):
    channel = writing_channel(owner, "document")
    owner_id = db.scalar(select(User.id))
    service = RunService(app.state.engine, app.state.settings.storage_path)
    prepared = service.prepare(
        owner_id,
        RunInput(
            place="documents",
            channel_id=channel["id"],
            kind="answer",
            instructions="Help",
            text="A draft",
        ),
    )
    stream = service.stream(prepared)
    assert json.loads(await anext(stream))["type"] == "start"
    await stream.aclose()
    run = db.get(AiRun, prepared.run_id)
    assert run.outcome == "cancelled"


@pytest.mark.parametrize("edited", [False, True], ids=["original-0025", "edited-0025"])
def test_0026_upgrades_both_0025_variants(engine: Engine, owner: TestClient, edited: bool):
    prompts = owner.get(f"{API}/ai/prompts").json()
    config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    with engine.begin() as connection:
        config.attributes["connection"] = connection
        command.downgrade(config, "0025_ai")
        if edited:
            connection.execute(text("ALTER TABLE ai_prompts DROP COLUMN web_search"))
        command.upgrade(config, "0026_ai_writing")
        assert (
            connection.scalar(text("SELECT version_num FROM alembic_version")) == "0026_ai_writing"
        )
        assert (
            connection.scalar(
                text(
                    "SELECT count(*) FROM information_schema.columns "
                    "WHERE table_schema=current_schema() AND table_name='ai_prompts' "
                    "AND column_name='web_search'"
                )
            )
            == 0
        )
        assert (
            connection.scalar(
                text(
                    "SELECT count(*) FROM information_schema.columns "
                    "WHERE table_schema=current_schema() AND table_name='ai_runs' "
                    "AND column_name='conversation_id'"
                )
            )
            == 1
        )
    assert owner.get(f"{API}/ai/prompts").json() == prompts
