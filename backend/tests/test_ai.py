import json
import os
import stat

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic_ai.exceptions import ModelHTTPError, ModelNotFoundError
from pydantic_ai.models.function import AgentInfo, FunctionModel
from pydantic_ai.models.test import TestModel

from app.ai import connection
from app.ai.runs import RunService
from tests.conftest import API

AUTH = json.dumps(
    {"tokens": {"access_token": "a.e30.b", "refresh_token": "refresh", "account_id": "acct-123456"}}
)


def events(response) -> list[dict]:
    assert response.status_code == 200, response.text
    return [json.loads(line) for line in response.text.splitlines() if line]


def post(owner: TestClient, channel: dict[str, str], content: str) -> dict:
    response = owner.post(f"{API}/channels/{channel['id']}/messages", json={"content": content})
    assert response.status_code == 201, response.text
    return response.json()


@pytest.fixture
def stand_in(monkeypatch):
    """Replaces ChatGPT with a local model, so no test reaches the network."""
    chosen: dict = {}

    def model(self, prepared):
        chosen["prepared"] = prepared
        return chosen["model"]

    monkeypatch.setattr(RunService, "model", model)
    return chosen


def test_connecting_stores_the_sign_in_privately(owner: TestClient, app: FastAPI) -> None:
    assert owner.get(f"{API}/ai/status").json() == {"connected": False}
    assert owner.post(f"{API}/ai/connection", json={"auth_json": "nope"}).status_code == 422
    missing = owner.post(f"{API}/ai/connection", json={"auth_json": '{"tokens": {}}'})
    assert missing.status_code == 422
    status = owner.post(f"{API}/ai/connection", json={"auth_json": AUTH})
    assert status.status_code == 200, status.text
    assert status.json()["connected"] is True and status.json()["account"] == "123456"
    path = connection.credentials_path(app.state.settings.storage_path)
    stored = json.loads(path.read_text())
    assert stored == {
        "access_token": "a.e30.b",
        "refresh_token": "refresh",
        "account_id": "acct-123456",
    }
    if os.name != "nt":
        assert stat.S_IMODE(path.stat().st_mode) == 0o600
    assert "refresh" not in json.dumps(owner.get(f"{API}/ai/status").json())
    assert owner.delete(f"{API}/ai/connection").status_code == 204
    assert not path.exists()


def test_preferences_default_to_gpt_6_1_sol(owner: TestClient) -> None:
    defaults = owner.get(f"{API}/ai/preferences").json()
    assert defaults["model"] == "gpt-6.1-sol"
    assert defaults["web_search"] is False and defaults["keep_history"] is True
    changed = owner.put(
        f"{API}/ai/preferences",
        json={**defaults, "thinking": "high", "standing_note": "Keep it casual."},
    )
    assert changed.status_code == 200
    assert owner.get(f"{API}/ai/preferences").json()["thinking"] == "high"
    assert (
        owner.put(f"{API}/ai/preferences", json={**defaults, "thinking": "max"}).status_code == 422
    )


def test_saved_prompts_start_with_the_starters_and_can_be_edited(owner: TestClient) -> None:
    prompts = owner.get(f"{API}/ai/prompts").json()
    assert [item["name"] for item in prompts][:3] == [
        "Fix spelling",
        "Make shorter",
        "Turn into tasks",
    ]
    assert len(prompts) == 11
    first = prompts[0]
    updated = owner.put(
        f"{API}/ai/prompts/{first['id']}",
        json={**first, "name": "Spelling", "kind": "draft", "revision": first["revision"]},
    )
    assert updated.status_code == 200 and updated.json()["revision"] == first["revision"] + 1
    stale = owner.put(
        f"{API}/ai/prompts/{first['id']}", json={**first, "revision": first["revision"]}
    )
    assert stale.status_code == 409
    created = owner.post(
        f"{API}/ai/prompts",
        json={"name": "Legs", "instructions": "Add the number of legs.", "kind": "rewrite"},
    )
    assert created.status_code == 201
    ids = [item["id"] for item in owner.get(f"{API}/ai/prompts").json()]
    order = owner.put(f"{API}/ai/prompts/order", json={"ids": list(reversed(ids))})
    assert [item["name"] for item in order.json()][0] == "Legs"
    for item in owner.get(f"{API}/ai/prompts").json():
        assert owner.delete(f"{API}/ai/prompts/{item['id']}").status_code == 204
    # Deleting every prompt doesn't bring the starters back.
    assert owner.get(f"{API}/ai/prompts").json() == []


def test_a_rewrite_streams_changes_by_message_and_is_kept_in_history(
    owner: TestClient, channel: dict[str, str], stand_in
) -> None:
    owner.post(f"{API}/ai/connection", json={"auth_json": AUTH})
    notes = [post(owner, channel, text) for text in ("dog", "cat", "bird")]
    stand_in["model"] = TestModel(
        call_tools=[],
        custom_output_args={
            "changes": [
                {"number": 1, "text": "dog - 4"},
                {"number": 2, "text": "cat - 4"},
                {"number": 3, "text": "bird - 2"},
                {"number": 9, "text": "not selected"},
            ]
        }
    )
    response = owner.post(
        f"{API}/ai/runs",
        json={
            "instructions": "Add how many legs each animal has.",
            "kind": "rewrite",
            "message_ids": [note["id"] for note in notes],
        },
    )
    sent = events(response)
    assert sent[0]["type"] == "start" and sent[0]["model"] == "gpt-6.1-sol"
    assert sent[-1]["type"] == "done"
    assert sent[-1]["output"] == [
        {"id": notes[0]["id"], "text": "dog - 4"},
        {"id": notes[1]["id"], "text": "cat - 4"},
        {"id": notes[2]["id"], "text": "bird - 2"},
    ]
    assert any(event["type"] == "changes" for event in sent[1:-1])
    prepared = stand_in["prepared"]
    assert [item["text"] for item in prepared.items] == ["dog", "cat", "bird"]
    runs = owner.get(f"{API}/ai/runs").json()
    assert runs[0]["outcome"] == "ready" and runs[0]["where"] == "#python · 3 messages"
    applied = owner.put(f"{API}/ai/runs/{runs[0]['id']}", json={"outcome": "applied"})
    assert applied.json()["outcome"] == "applied"
    assert owner.delete(f"{API}/ai/runs").status_code == 204
    assert owner.get(f"{API}/ai/runs").json() == []


def test_answers_stream_as_text_and_saved_prompts_and_notes_apply(
    owner: TestClient, channel: dict[str, str], stand_in
) -> None:
    owner.post(f"{API}/ai/connection", json={"auth_json": AUTH})
    preferences = owner.get(f"{API}/ai/preferences").json()
    owner.put(f"{API}/ai/preferences", json={**preferences, "standing_note": "Be kind."})
    note = post(owner, channel, "dog")
    seen: dict = {}

    async def answer(messages, info: AgentInfo):
        seen["instructions"] = info.instructions
        yield "Dogs "
        yield "have 4 legs."

    stand_in["model"] = FunctionModel(stream_function=answer)
    summarise = next(
        item for item in owner.get(f"{API}/ai/prompts").json() if item["name"] == "Summarise"
    )
    sent = events(
        owner.post(
            f"{API}/ai/runs", json={"prompt_id": summarise["id"], "message_ids": [note["id"]]}
        )
    )
    texts = [event["text"] for event in sent if event["type"] == "text"]
    assert texts[-1] == "Dogs have 4 legs." and sent[-1]["output"] == "Dogs have 4 legs."
    assert "Be kind." in seen["instructions"]
    assert stand_in["prepared"].kind == "answer"


def test_failures_become_events_the_app_can_explain(
    owner: TestClient, channel: dict[str, str], stand_in
) -> None:
    owner.post(f"{API}/ai/connection", json={"auth_json": AUTH})
    note = post(owner, channel, "dog")

    async def missing(messages, info):
        raise ModelNotFoundError("gpt-6.1-sol", "The model does not exist")
        yield ""  # pragma: no cover

    async def refused(messages, info):
        raise ModelHTTPError(status_code=429, model_name="gpt-6.1-sol", body={"detail": "limit"})
        yield ""  # pragma: no cover

    for stream, code in ((missing, "model"), (refused, "limit")):
        stand_in["model"] = FunctionModel(stream_function=stream)
        sent = events(
            owner.post(
                f"{API}/ai/runs",
                json={"instructions": "Explain", "kind": "answer", "message_ids": [note["id"]]},
            )
        )
        assert sent[-1]["type"] == "error" and sent[-1]["code"] == code, sent[-1]
    assert [run["outcome"] for run in owner.get(f"{API}/ai/runs").json()] == ["limit", "failed"]
    nothing = owner.post(f"{API}/ai/runs", json={"instructions": "Explain", "kind": "answer"})
    assert nothing.status_code == 422


def test_noted_signs_in_with_its_own_chatgpt_session(owner: TestClient, monkeypatch) -> None:
    from urllib.parse import parse_qs, urlsplit

    from pydantic_ai.providers.openai_codex import OpenAICodexCredentials, OpenAICodexOAuthFlow

    started = owner.post(f"{API}/ai/connection/sign-in")
    assert started.status_code == 200
    url = started.json()["url"]
    assert url.startswith("https://auth.openai.com/oauth/authorize")
    query = parse_qs(urlsplit(url).query)
    assert query["redirect_uri"] == ["http://localhost:1455/auth/callback"]
    state = query["state"][0]

    async def exchange(self, code: str) -> OpenAICodexCredentials:
        assert code == "the-code"
        return OpenAICodexCredentials(
            access_token="a.e30.b", refresh_token="r", account_id="acct-own000"
        )

    monkeypatch.setattr(OpenAICodexOAuthFlow, "exchange_code", exchange)
    finish = f"{API}/ai/connection/sign-in/finish"
    assert owner.post(finish, json={"address": "http://localhost:1455/nothing"}).status_code == 422
    wrong = owner.post(
        finish, json={"address": "http://localhost:1455/auth/callback?code=x&state=wrong"}
    )
    assert wrong.status_code == 422
    done = owner.post(
        finish, json={"address": f"http://localhost:1455/auth/callback?code=the-code&state={state}"}
    )
    assert done.status_code == 200, done.text
    assert done.json()["account"] == "own000"
    again = owner.post(
        finish, json={"address": f"http://localhost:1455/auth/callback?code=the-code&state={state}"}
    )
    assert again.status_code == 422
