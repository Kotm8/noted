from datetime import timedelta
from uuid import UUID, uuid4

from app.ai.knowledge.tools import NotedKnowledge
from app.core.security import utc_now
from app.reminders.models import Reminder
from tests.conftest import API
from tests.test_ai import AUTH
from tests.test_assistant_chats import PROPOSAL, answering, ask, scope
from tests.test_plan_prompts import NOW, activity, due, planned
from tests.test_reminders import create


def test_cross_channel_post_is_reviewed_before_apply_and_returns_real_link(
    owner, channel, monkeypatch
):
    owner.post(f"{API}/ai/connection", json={"auth_json": AUTH})
    text = "## First routine\n\n- [ ] Three sets of push-ups\n- Rest **90 seconds**"
    answering(
        monkeypatch, [], output={**PROPOSAL, "posts": [{"channel_id": channel["id"], "text": text}]}
    )
    found = ask(owner, {**scope(owner), "instructions": "Put the routine in Programming / python"})
    post = found[-1]["output"]["posts"][0]
    assert post["destination"]["channel_name"] == "python"
    assert owner.get(f"{API}/channels/{channel['id']}/messages").json()["items"] == []
    body = {"request_id": str(uuid4()), "posts": [{**post, "key": "post-0"}]}
    result = owner.post(f"{API}/ai/assistant/apply-actions", json=body)
    assert result.status_code == 200, result.text
    saved = result.json()["results"][0]
    assert saved["ok"] and saved["message_id"] in saved["url"]
    assert owner.post(f"{API}/ai/assistant/apply-actions", json=body).json() == result.json()
    items = owner.get(f"{API}/channels/{channel['id']}/messages").json()["items"]
    assert len(items) == 1 and items[0]["content"] == text


def test_deletion_requires_confirmation_and_reports_each_action(owner, channel):
    first = owner.post(
        f"{API}/channels/{channel['id']}/messages", json={"content": "Delete me"}
    ).json()
    body = {
        "request_id": str(uuid4()),
        "deletions": [
            {"key": "delete-0", "kind": "message", "id": first["id"]},
            {"key": "delete-1", "kind": "message", "id": str(uuid4())},
        ],
    }
    assert owner.post(f"{API}/ai/assistant/apply-actions", json=body).status_code == 422
    response = owner.post(f"{API}/ai/assistant/apply-actions", json={**body, "confirmed": True})
    assert response.status_code == 200, response.text
    assert [item["ok"] for item in response.json()["results"]] == [True, False]
    retried = owner.post(f"{API}/ai/assistant/apply-actions", json={**body, "confirmed": True})
    assert retried.json()["results"][0]["ok"]
    assert owner.get(f"{API}/channels/{channel['id']}/messages").json()["items"] == []
    for kind in ("document", "channel"):
        bad = {
            **body,
            "confirmed": True,
            "deletions": [{"key": "delete-0", "kind": kind, "id": channel["id"]}],
        }
        assert owner.post(f"{API}/ai/assistant/apply-actions", json=bad).status_code == 422
    journal = owner.post(
        f"{API}/workspaces/{channel['workspace_id']}/channels",
        json={"name": "Journal", "kind": "journal"},
    ).json()
    entry = owner.post(
        f"{API}/channels/{journal['id']}/journal", json={"title": "A disposable entry"}
    ).json()
    deletion = {
        "key": "delete-0",
        "kind": "journal",
        "id": entry["id"],
        "revision": entry["revision"],
    }
    response = owner.post(
        f"{API}/ai/assistant/apply-actions",
        json={"request_id": str(uuid4()), "confirmed": True, "deletions": [deletion]},
    )
    assert response.json()["results"][0]["ok"], response.text
    assert owner.get(f"{API}/journal/{entry['id']}").status_code == 404


def test_recurring_deletion_requires_a_scope_and_only_removes_selected_occurrence(owner):
    item = activity(owner, "Study")
    plan = planned(owner, item["id"], frequency="daily")
    change = {"key": "delete-0", "kind": "plan", "id": plan["id"], "revision": plan["revision"]}
    body = {"request_id": str(uuid4()), "confirmed": True, "deletions": [change]}
    assert not owner.post(f"{API}/ai/assistant/apply-actions", json=body).json()["results"][0]["ok"]
    body["deletions"] = [{**change, "scope": "occurrence", "occurrence_date": plan["date"]}]
    result = owner.post(f"{API}/ai/assistant/apply-actions", json=body)
    assert result.json()["results"][0]["ok"], result.text
    assert owner.get(f"{API}/schedule/plans/{plan['id']}").status_code == 200


def test_notifications_reconcile_current_revision_and_manual_task_change(
    owner, channel, db, monkeypatch
):
    message = create(owner, channel)
    reminder = db.get(Reminder, UUID(message["id"]))
    reminder.due_at = utc_now() - timedelta(minutes=1)
    db.commit()
    token = f"reminder:{message['id']}:1"
    assert owner.get(f"{API}/notifications/reconcile", params={"items": token}).json() == {
        "stale": []
    }
    owner.post(
        f"{API}/messages/{message['id']}/reminder/actions", json={"action": "done", "revision": 1}
    )
    assert owner.get(f"{API}/notifications/reconcile", params={"items": token}).json() == {
        "stale": [token]
    }
    removed = create(owner, channel)
    assert owner.delete(f"{API}/messages/{removed['id']}").status_code == 204
    db.expire_all()
    cancelled = db.get(Reminder, UUID(removed["id"]))
    assert cancelled.status == "done" and cancelled.revision == 2
    from app.schedule.prompts import service
    from app.time_tracking import service as tracking

    monkeypatch.setattr(service, "utc_now", lambda: NOW)
    monkeypatch.setattr(tracking, "utc_now", lambda: NOW)
    reading, working = activity(owner, "Reading"), activity(owner, "Working")
    planned(owner, reading["id"])
    prompt = due(owner)[0]
    state = owner.get(f"{API}/time-tracking/tracker").json()
    changed = owner.post(
        f"{API}/time-tracking/tracker",
        json={
            "action": "start",
            "activity_id": working["id"],
            "revision": state["revision"],
            "request_id": str(uuid4()),
        },
    )
    assert changed.status_code == 200, changed.text
    assert due(owner) == []
    token = f"plan:{prompt['id']}:{prompt['revision']}"
    assert owner.get(f"{API}/notifications/reconcile", params={"items": token}).json()["stale"] == [
        token
    ]


def test_destination_lookup_keeps_duplicate_names_and_isolates_owner(
    owner, channel, engine, tmp_path
):
    owner_id = UUID(owner.get(f"{API}/auth/session").json()["id"])
    lookup = NotedKnowledge(engine, tmp_path, owner_id)
    found = lookup.find_channels("python", "Programming")
    assert found["matches"][0]["channel_id"] == channel["id"]
    owner.post(f"{API}/workspaces/{channel['workspace_id']}/channels", json={"name": "python"})
    assert lookup.find_channels("python", "Programming")["ambiguous"]
    assert lookup.find_channels("python", "Programming", category="Backend")["total"] == 1
    assert NotedKnowledge(engine, tmp_path, uuid4()).find_channels("python")["matches"] == []
