import base64
import json
import os
import tempfile
import threading
import time
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlsplit

import httpx2
from pydantic_ai.providers.openai_codex import (
    OpenAICodexCredentials,
    OpenAICodexCredentialSource,
    OpenAICodexOAuthFlow,
    OpenAICodexProvider,
)

from app.core.errors import ValidationError

CODEX_BASE = "https://chatgpt.com/backend-api/codex"
# The model list depends on the client version the request names; newer ones list newer models.
CLIENT_VERSIONS = ("1.2.0", "1.0.0", "0.200.0", "0.160.0", "0.150.0")
_lock = threading.Lock()
_providers: dict[Path, OpenAICodexProvider] = {}
_usage: dict[Path, dict[str, Any]] = {}
_flows: dict[str, tuple[OpenAICodexOAuthFlow, float]] = {}
FLOW_SECONDS = 15 * 60


def credentials_path(storage: Path) -> Path:
    return storage / ".server" / "ai-credentials.json"


def _write_private(path: Path, data: dict[str, Any]) -> None:
    """Like the Firebase file: owner-only, written atomically, never through a symlink."""
    if path.parent.is_symlink():
        raise ValidationError("The server configuration directory must not be a symbolic link.")
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=".ai-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as file:
            json.dump(data, file)
            file.flush()
            os.fsync(file.fileno())
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


class FileCredentials(OpenAICodexCredentialSource):
    """Keeps the ChatGPT sign-in on the server. Refresh tokens work once, so every refresh the
    provider makes is saved straight away."""

    def __init__(self, path: Path) -> None:
        self.path = path

    async def load(self) -> OpenAICodexCredentials:
        return OpenAICodexCredentials(**json.loads(self.path.read_text(encoding="utf-8")))

    async def save(self, credentials: OpenAICodexCredentials) -> None:
        _write_private(self.path, asdict(credentials))


def _claims(token: str) -> dict[str, Any]:
    """Unverified token claims, only to show the plan and expiry in Settings."""
    try:
        payload = token.split(".")[1]
        parsed: dict[str, Any] = json.loads(
            base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4))
        )
        return parsed
    except (IndexError, ValueError):
        return {}


def parse_auth(text: str) -> OpenAICodexCredentials:
    """Accepts the Codex CLI's auth.json, or the three fields on their own."""
    try:
        data = json.loads(text)
    except ValueError:
        raise ValidationError("That isn't valid JSON. Paste the whole auth.json file.") from None
    if not isinstance(data, dict):
        raise ValidationError("Paste the whole auth.json file.")
    try:
        if "tokens" in data:
            return OpenAICodexCredentials.from_codex_cli_auth(data)
        return OpenAICodexCredentials(
            access_token=str(data["access_token"]),
            refresh_token=str(data["refresh_token"]),
            account_id=str(data["account_id"]),
        )
    except (KeyError, Exception) as error:
        raise ValidationError(
            "This auth.json has no ChatGPT sign-in. Run `codex login` again and paste the new file."
        ) from error


def start_sign_in() -> str:
    """A ChatGPT sign-in of Noted's own, separate from any Codex app on the owner's computers,
    so neither one's token refresh signs the other out.

    The sign-in page sends the browser to `localhost:1455`, the only address the Codex client
    may use. Nothing answers there, but the address bar then holds the one-time code, which
    the owner pastes back into `finish_sign_in`.
    """
    now = time.time()
    with _lock:
        for state, (_, created) in list(_flows.items()):
            if now - created > FLOW_SECONDS:
                _flows.pop(state, None)
        flow = OpenAICodexOAuthFlow()
        _flows[flow.state] = (flow, now)
    return flow.authorization_url()


async def finish_sign_in(storage: Path, address: str) -> None:
    query = parse_qs(urlsplit(address.strip()).query)
    code, state = (query.get("code") or [""])[0], (query.get("state") or [""])[0]
    if not code or not state:
        raise ValidationError(
            "Paste the whole address of the page that didn't load. It starts with http://localhost:1455."
        )
    with _lock:
        found = _flows.pop(state, None)
    if found is None or time.time() - found[1] > FLOW_SECONDS:
        raise ValidationError("This sign-in expired or was already used. Start it again.")
    try:
        credentials = await found[0].exchange_code(code)
    except Exception as error:
        raise ValidationError("ChatGPT didn't accept that sign-in. Start it again.") from error
    connect(storage, credentials)


def connect(storage: Path, credentials: OpenAICodexCredentials) -> None:
    with _lock:
        _write_private(credentials_path(storage), asdict(credentials))
        _providers.pop(storage, None)
        _usage.pop(storage, None)


def disconnect(storage: Path) -> None:
    with _lock:
        credentials_path(storage).unlink(missing_ok=True)
        _providers.pop(storage, None)
        _usage.pop(storage, None)


def connected(storage: Path) -> bool:
    return credentials_path(storage).exists()


def provider(storage: Path) -> OpenAICodexProvider:
    """One provider for the whole server, so its refresh lock covers every request and two
    requests never spend the same single-use refresh token."""
    with _lock:
        existing = _providers.get(storage)
        if existing is not None:
            return existing
        if not connected(storage):
            raise ValidationError("Connect ChatGPT in Settings › AI first.")

        async def remember(response: httpx2.Response) -> None:
            headers = {
                name.removeprefix("x-codex-"): value
                for name, value in response.headers.items()
                if name.startswith("x-codex-") and "turn-state" not in name
            }
            if headers:
                _usage[storage] = {**headers, "seen_at": time.time()}

        client = httpx2.AsyncClient(
            timeout=httpx2.Timeout(180, connect=20), event_hooks={"response": [remember]}
        )
        created = OpenAICodexProvider(
            credential_source=FileCredentials(credentials_path(storage)), http_client=client
        )
        _providers[storage] = created
        return created


def status(storage: Path) -> dict[str, Any]:
    path = credentials_path(storage)
    if not path.exists():
        return {"connected": False}
    data = json.loads(path.read_text(encoding="utf-8"))
    claims = _claims(data.get("access_token", ""))
    auth = claims.get("https://api.openai.com/auth", {})
    usage = _usage.get(storage, {})

    def number(key: str) -> float | None:
        try:
            return float(usage[key])
        except (KeyError, ValueError):
            return None

    resets = {
        key: usage.get(f"{window}-reset-at")
        for key, window in (("hours", "primary"), ("week", "secondary"))
    }
    return {
        "connected": True,
        "plan": auth.get("chatgpt_plan_type") or usage.get("plan-type"),
        "account": str(data.get("account_id", ""))[-6:],
        "connected_at": datetime.fromtimestamp(path.stat().st_mtime, UTC).isoformat(),
        "usage": {
            "five_hours_percent": number("primary-used-percent"),
            "week_percent": number("secondary-used-percent"),
            "five_hours_resets_at": _timestamp(resets["hours"]),
            "week_resets_at": _timestamp(resets["week"]),
        }
        if usage
        else None,
    }


def _timestamp(value: Any) -> str | None:
    try:
        return datetime.fromtimestamp(int(value), UTC).isoformat()
    except (TypeError, ValueError):
        return None


async def models(storage: Path) -> list[dict[str, Any]]:
    """The models the plan offers, as the Codex backend lists them for recent clients."""
    client = provider(storage).client._client
    for version in CLIENT_VERSIONS:
        response = await client.get(f"{CODEX_BASE}/models", params={"client_version": version})
        if response.status_code != 200:
            continue
        body = response.json()
        entries = body.get("models", []) if isinstance(body, dict) else []
        listed = [
            {
                "id": entry.get("slug"),
                "name": entry.get("display_name") or entry.get("slug"),
                "description": entry.get("description") or "",
                "thinking": [
                    level.get("effort") for level in entry.get("supported_reasoning_levels") or []
                ],
            }
            for entry in entries
            if isinstance(entry, dict)
            and entry.get("slug")
            and "review" not in entry.get("slug", "")
        ]
        if listed:
            return listed
    return []
