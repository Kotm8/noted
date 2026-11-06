import json

from pydantic_ai.messages import ToolReturnPart
from pydantic_ai.models.function import DeltaToolCall, FunctionModel

from app.ai.runs import RunService
from tests.conftest import API
from tests.test_ai import AUTH
from tests.test_nutrition import OATS, PROFILE, events, photo_bytes, today

PROPOSAL = {"explanation": "Noted", "habits": [], "plans": [], "meals": []}


def scope(owner):
    day = today(owner)
    return {"start": day, "end": day, "timezone": "UTC", "start_minute": 0, "end_minute": 1440}


def answering(monkeypatch, captured, first_tool=None, output=PROPOSAL):
    """A stand-in model that may call one tool first, then returns its proposal."""

    async def answer(messages, info):
        captured.append(messages)
        called = any(
            isinstance(part, ToolReturnPart) for part in getattr(messages[-1], "parts", [])
        )
        if first_tool and not called:
            name, args = first_tool
            yield {0: DeltaToolCall(name=name, json_args=json.dumps(args))}
            return
        yield {0: DeltaToolCall(name=info.output_tools[0].name, json_args=json.dumps(output))}

    monkeypatch.setattr(RunService, "model", lambda *_: FunctionModel(stream_function=answer))


def ask(owner, body):
    found = events(owner.post(f"{API}/ai/assistant", json=body))
    assert found[-1]["type"] == "done", found
    return found


def test_chats_are_kept_on_the_server_and_continue_from_there(owner, monkeypatch):
    owner.post(f"{API}/ai/connection", json={"auth_json": AUTH})
    captured: list = []
    answering(monkeypatch, captured)
    first = ask(owner, {**scope(owner), "instructions": "Plan my week around the gym"})
    chat_id = first[0]["chat_id"]
    assert first[0]["type"] == "chat"
    assert any(item["type"] == "turn" for item in first)

    edited = json.dumps({**PROPOSAL, "explanation": "Edited by the owner"})
    ask(
        owner,
        {
            **scope(owner),
            "instructions": "And add stretching",
            "chat_id": chat_id,
            "history": [{"role": "assistant", "content": edited}],
        },
    )
    sent = str(captured[-1])
    assert "Plan my week around the gym" in sent and "Edited by the owner" in sent

    listed = owner.get(f"{API}/ai/assistant/chats").json()
    assert [item["title"] for item in listed] == ["Plan my week around the gym"]
    turns = owner.get(f"{API}/ai/assistant/chats/{chat_id}").json()
    assert [turn["role"] for turn in turns] == ["user", "assistant", "user", "assistant"]
    assert turns[1]["proposal"]["explanation"] == "Noted"

    answering(monkeypatch, captured, ("search_assistant_chats", {"query": "gym"}), PROPOSAL)
    ask(owner, {**scope(owner), "instructions": "What did we say about training?"})
    assert "Plan my week around the gym" in str(captured[-1])

    assert owner.delete(f"{API}/ai/assistant/chats/{chat_id}").status_code == 204
    assert owner.get(f"{API}/ai/assistant/chats/{chat_id}").status_code == 404


def test_memory_is_only_used_and_written_when_turned_on(owner, monkeypatch):
    owner.post(f"{API}/ai/connection", json={"auth_json": AUTH})
    captured: list = []
    answering(monkeypatch, captured, ("remember", {"fact": "Prefers metric units"}))
    found = events(owner.post(f"{API}/ai/assistant", json={**scope(owner), "instructions": "Hi"}))
    assert found[-1]["type"] in ("done", "error")
    assert owner.get(f"{API}/ai/memories").json() == []

    preferences = owner.get(f"{API}/ai/preferences").json()
    owner.put(f"{API}/ai/preferences", json={**preferences, "memory": True})
    found = ask(owner, {**scope(owner), "instructions": "I use kilograms, remember that"})
    assert any(item["type"] == "memory" for item in found)
    memories = owner.get(f"{API}/ai/memories").json()
    assert [item["text"] for item in memories] == ["Prefers metric units"]

    answering(monkeypatch, captured)
    ask(owner, {**scope(owner), "instructions": "How heavy is my bag?"})
    assert "Prefers metric units" in str(captured[-1])

    assert owner.delete(f"{API}/ai/memories/{memories[0]['id']}").status_code == 204
    assert owner.get(f"{API}/ai/memories").json() == []


def test_assistant_logs_a_meal_from_an_attached_picture(owner, monkeypatch):
    from uuid import uuid4

    owner.post(f"{API}/ai/connection", json={"auth_json": AUTH})
    owner.put(f"{API}/nutrition/profile", json=PROFILE)
    upload = owner.post(
        f"{API}/nutrition/photos", files={"file": ("lunch.jpg", photo_bytes(), "image/jpeg")}
    )
    assert upload.status_code == 201, upload.text
    photo_id = upload.json()["id"]
    captured: list = []
    answering(monkeypatch, captured)
    found = ask(owner, {**scope(owner), "instructions": "Log this", "photo_ids": [photo_id]})
    sent = str(captured[-1])
    assert photo_id in sent and ("BinaryContent" in sent or "image/webp" in sent)

    day = today(owner)
    fields = {"day": day, "minute": 800, "slot": "Lunch", "name": "Oats", "items": [OATS]}
    applied = owner.post(
        f"{API}/ai/assistant/apply",
        json={
            **scope(owner),
            "explanation": "Logged",
            "habits": [],
            "plans": [],
            "meals": [{"id": None, "revision": None, "fields": fields, "photo_ids": [photo_id]}],
            "request_id": str(uuid4()),
            "turn_id": next(item["turn_id"] for item in found if item["type"] == "turn"),
        },
    )
    assert applied.status_code == 200, applied.text
    meal = owner.get(f"{API}/nutrition/meals?start={day}&end={day}").json()[0]
    assert meal["photo_ids"] == [photo_id]
    chat_id = found[0]["chat_id"]
    turns = owner.get(f"{API}/ai/assistant/chats/{chat_id}").json()
    assert turns[0]["photo_ids"] == [photo_id] and turns[1]["applied"] is True


def test_turning_nutrition_off_hides_meals_from_the_assistant(owner, monkeypatch):
    owner.post(f"{API}/ai/connection", json={"auth_json": AUTH})
    owner.put(f"{API}/nutrition/profile", json=PROFILE)
    owner.post(
        f"{API}/nutrition/meals",
        json={
            "day": today(owner),
            "minute": 490,
            "slot": "Breakfast",
            "name": "Secret oats",
            "items": [OATS],
        },
    )
    preferences = owner.get(f"{API}/ai/preferences").json()
    assert preferences["nutrition"] is True and preferences["memory"] is False
    owner.put(f"{API}/ai/preferences", json={**preferences, "nutrition": False})
    captured: list = []
    answering(monkeypatch, captured)
    ask(owner, {**scope(owner), "instructions": "What did I eat?"})
    assert "Secret oats" not in str(captured[-1]) and "turned Nutrition off" in str(captured[-1])


def test_backups_keep_assistant_chats_and_memories(owner, monkeypatch):
    from tests.test_backups import export, upload

    owner.post(f"{API}/ai/connection", json={"auth_json": AUTH})
    preferences = owner.get(f"{API}/ai/preferences").json()
    owner.put(f"{API}/ai/preferences", json={**preferences, "memory": True})
    captured: list = []
    answering(monkeypatch, captured, ("remember", {"fact": "Trains on Mondays"}))
    ask(owner, {**scope(owner), "instructions": "Remember I train on Mondays"})

    _ready, raw = export(owner)
    preview = upload(owner, raw)
    assert preview.status_code == 200, preview.text
    assert preview.json()["counts"]["assistant_chats"] == 1
    restored = owner.post(
        f"{API}/backups/import",
        json={
            "token": preview.json()["token"],
            "mode": "replace",
            "confirmation": "REPLACE MY NOTES",
        },
    )
    assert restored.status_code == 200, restored.text
    chats = owner.get(f"{API}/ai/assistant/chats").json()
    assert [chat["title"] for chat in chats] == ["Remember I train on Mondays"]
    turns = owner.get(f"{API}/ai/assistant/chats/{chats[0]['id']}").json()
    assert [turn["role"] for turn in turns] == ["user", "assistant"]
    assert [item["text"] for item in owner.get(f"{API}/ai/memories").json()] == [
        "Trains on Mondays"
    ]


def test_writing_prompts_read_memory_while_it_is_on(owner, monkeypatch):
    from pydantic_ai.messages import ModelMessage
    from pydantic_ai.models.function import AgentInfo

    owner.post(f"{API}/ai/connection", json={"auth_json": AUTH})
    captured: list = []
    answering(monkeypatch, captured, ("remember", {"fact": "Writes in British English"}))
    preferences = owner.get(f"{API}/ai/preferences").json()
    owner.put(f"{API}/ai/preferences", json={**preferences, "memory": True})
    ask(owner, {**scope(owner), "instructions": "I write in British English"})

    seen: list[str] = []

    async def write(messages: list[ModelMessage], info: AgentInfo):
        seen.append(str(info.instructions))
        yield "Colour"

    monkeypatch.setattr(RunService, "model", lambda *_: FunctionModel(stream_function=write))
    body = {"instructions": "Fix spelling", "kind": "rewrite", "place": "composer", "text": "Color"}
    assert events(owner.post(f"{API}/ai/runs", json=body))[-1]["type"] == "done"
    assert "Writes in British English" in seen[-1]

    owner.put(f"{API}/ai/preferences", json={**preferences, "memory": False})
    events(owner.post(f"{API}/ai/runs", json=body))
    assert "Writes in British English" not in seen[-1]


def streamed(monkeypatch, captured, output):
    """A stand-in model that writes its answer in small pieces, as ChatGPT does."""

    async def answer(messages, info):
        captured.append(messages)
        encoded = json.dumps(output)
        for index in range(0, len(encoded), 12):
            yield {
                0: DeltaToolCall(
                    name=info.output_tools[0].name if index == 0 else None,
                    json_args=encoded[index : index + 12],
                )
            }

    monkeypatch.setattr(RunService, "model", lambda *_: FunctionModel(stream_function=answer))


def post(owner, channel_id, content):
    response = owner.post(f"{API}/channels/{channel_id}/messages", json={"content": content})
    assert response.status_code == 201, response.text
    return response.json()


def test_attached_messages_get_rewrites_and_streamed_answers(owner, channel, monkeypatch):
    owner.post(f"{API}/ai/connection", json={"auth_json": AUTH})
    first, second = post(owner, channel["id"], "teh cat"), post(owner, channel["id"], "fine")
    captured: list = []
    streamed(
        monkeypatch,
        captured,
        {
            **PROPOSAL,
            "explanation": "Fixed the **spelling** in one message.",
            "rewrites": [{"number": 1, "text": "the cat"}, {"number": 9, "text": "ignored"}],
        },
    )
    found = ask(
        owner,
        {
            **scope(owner),
            "instructions": "Fix spelling",
            "context": {"channel_id": channel["id"], "message_ids": [first["id"], second["id"]]},
        },
    )
    written = [item["text"] for item in found if item["type"] == "explanation"]
    assert len(written) > 1 and written[-1] == "Fixed the **spelling** in one message."
    assert found[-1]["output"]["rewrites"] == [{"id": first["id"], "text": "the cat"}]
    sent = str(captured[-1])
    assert "teh cat" in sent and "#python" in sent
    turns = owner.get(f"{API}/ai/assistant/chats/{found[0]['chat_id']}").json()
    assert turns[0]["attached"]["message_ids"] == [first["id"], second["id"]]
    assert owner.get(f"{API}/channels/{channel['id']}/messages").json()["items"][0]["content"] in (
        "teh cat",
        "fine",
    )


def test_replies_are_posted_in_the_thread_and_marked_as_ai(owner, channel, monkeypatch):
    owner.post(f"{API}/ai/connection", json={"auth_json": AUTH})
    root = post(owner, channel["id"], "Ideas for the weekend?")
    prompts = owner.get(f"{API}/ai/prompts").json()
    ideas = next(item for item in prompts if item["name"] == "Ideas for this")
    captured: list = []
    answering(monkeypatch, captured, None, {**PROPOSAL, "reply": "1. Hike\n2. Museum"})
    found = ask(
        owner,
        {
            **scope(owner),
            "context": {
                "channel_id": channel["id"],
                "message_ids": [root["id"]],
                "thread_root_id": root["id"],
                "prompt_id": ideas["id"],
            },
        },
    )
    assert "three ideas" in str(captured[-1]) and "inside a thread" in str(captured[-1])
    posted = found[-1]["output"]["posted"]
    assert posted["thread_root_id"] == root["id"]
    thread = owner.get(f"{API}/messages/{root['id']}/thread").json()
    reply = next(i for i in thread["replies"]["items"] if i["id"] == posted["message_id"])
    assert reply["content"] == "1. Hike\n2. Museum" and reply["ai_generated"] is True
    chats = owner.get(f"{API}/ai/assistant/chats").json()
    assert chats[0]["title"] == "Ideas for this"

    other = owner.post(f"{API}/workspaces", json={"name": "Elsewhere"}).json()
    elsewhere = owner.post(f"{API}/workspaces/{other['id']}/channels", json={"name": "x"}).json()
    response = owner.post(
        f"{API}/ai/assistant",
        json={
            **scope(owner),
            "instructions": "Reply",
            "context": {"channel_id": elsewhere["id"], "message_ids": [root["id"]]},
        },
    )
    assert response.status_code == 422
