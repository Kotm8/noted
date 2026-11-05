# /// script
# requires-python = ">=3.12"
# dependencies = ["pydantic-ai-slim[openai]==2.65.0", "psutil"]
# ///
"""Checks how Noted's planned AI connection behaves: Pydantic AI's `openai-codex` provider on a
ChatGPT subscription, before any of it is built into Noted.

Runs the same way on a PC and on the VPS. Every check prints PASS, FAIL, or SKIP, and the full
results (timings, usage, response headers, errors) go to a JSON report that never contains
tokens. Nothing in Noted is touched.

Credentials: the script keeps its own copy (`--store`), seeded once from the Codex CLI's
`auth.json` (`--auth`). Refresh tokens are single-use, so whenever the provider refreshes, the
new tokens are saved to the copy and, unless `--no-sync-cli`, written back into the CLI's file
(after a one-time backup) so `codex` itself keeps working.

    uv run scripts/ai_check.py --auth ~/.codex/auth.json
    uv run scripts/ai_check.py --auth auth.json --refresh-test --report report.json
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import json
import os
import platform
import shutil
import sys
import time
import traceback
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import psutil

STARTED = time.perf_counter()
PROCESS = psutil.Process()
RSS_BEFORE_IMPORT = PROCESS.memory_info().rss

import httpx2  # noqa: E402  (imported after the memory baseline on purpose)
import pydantic_ai  # noqa: E402
from pydantic import BaseModel, Field  # noqa: E402
from pydantic_ai import Agent, NativeOutput, PromptedOutput, ToolOutput  # noqa: E402
from pydantic_ai.capabilities import NativeTool  # noqa: E402
from pydantic_ai.messages import BinaryContent, ModelMessagesTypeAdapter  # noqa: E402
from pydantic_ai.models.openai import OpenAIResponsesModelSettings  # noqa: E402
from pydantic_ai.models.openai_codex import OpenAICodexModel  # noqa: E402
from pydantic_ai.native_tools import WebFetchTool, WebSearchTool  # noqa: E402
from pydantic_ai.providers.openai_codex import (  # noqa: E402
    OpenAICodexCredentials,
    OpenAICodexCredentialSource,
    OpenAICodexProvider,
)

RSS_AFTER_IMPORT = PROCESS.memory_info().rss
CODEX_BASE = "https://chatgpt.com/backend-api/codex"
# Response headers worth recording: rate limits, plan usage, request ids. Never cookies or auth.
HEADER_HINTS = ("ratelimit", "rate-limit", "limit", "usage", "codex", "request-id", "openai", "retry")
HEADER_BLOCK = ("cookie", "authorization", "token", "turn-state")
# Codex versions to ask for the model list with; the list depends on the client version.
CLIENT_VERSIONS = ("1.2.0", "1.0.0", "0.200.0", "0.180.0", "0.160.0", "0.150.0", "0.140.0", "0.130.0", "0.120.0", "0.110.0", "0.100.0", "0.98.0")


def solid_png(red: int, green: int, blue: int, size: int = 16) -> bytes:
    """A valid one-colour PNG, so the image check needs no files."""
    import struct
    import zlib

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    row = b"\x00" + bytes((red, green, blue)) * size
    header = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    signature = b"\x89PNG\r\n\x1a\n"
    return signature + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(row * size)) + chunk(b"IEND", b"")


RED_PNG = solid_png(220, 30, 30)


# ---------------------------------------------------------------- results


@dataclass
class Check:
    name: str
    status: str = "SKIP"
    seconds: float | None = None
    details: dict[str, Any] = field(default_factory=dict)
    error: dict[str, Any] | None = None


class Report:
    def __init__(self) -> None:
        self.checks: list[Check] = []
        self.headers: dict[str, str] = {}
        self.responses: list[dict[str, Any]] = []
        self.peak_rss = RSS_AFTER_IMPORT

    def sample_memory(self) -> None:
        self.peak_rss = max(self.peak_rss, PROCESS.memory_info().rss)

    async def run(self, name: str, step, *args) -> Check:
        check = Check(name)
        self.checks.append(check)
        began = time.perf_counter()
        try:
            details = await step(*args)
            check.details = details or {}
            check.status = "FAIL" if check.details.pop("_failed", False) else "PASS"
        except Skip as skip:
            check.status, check.details = "SKIP", {"reason": str(skip)}
        except Exception as error:  # noqa: BLE001  (every failure is a result here)
            check.status, check.error = "FAIL", describe(error)
        check.seconds = round(time.perf_counter() - began, 3)
        self.sample_memory()
        summary = check.details.get("summary") or (check.error or {}).get("message", "")
        print(f"  {check.status:<4}  {name:<34} {check.seconds or 0:>6.2f}s  {str(summary)[:110]}")
        return check


class Skip(Exception):
    pass


def describe(error: BaseException) -> dict[str, Any]:
    """An error as data: its class chain, HTTP status and body if any, and where it came from."""
    info: dict[str, Any] = {
        "type": type(error).__name__,
        "classes": [cls.__name__ for cls in type(error).__mro__[:6]],
        "message": redact(str(error))[:2000],
    }
    for attribute in ("status_code", "model_name", "body"):
        value = getattr(error, attribute, None)
        if value is not None:
            info[attribute] = redact(json.dumps(value, default=str))[:3000]
    if error.__cause__ is not None:
        info["cause"] = {"type": type(error.__cause__).__name__, "message": redact(str(error.__cause__))[:1000]}
    info["traceback"] = redact("".join(traceback.format_exception(error))[-3000:])
    return info


SECRETS: list[str] = []


def redact(text: str) -> str:
    for secret in SECRETS:
        if secret:
            text = text.replace(secret, "[redacted]")
    return text


# ---------------------------------------------------------------- credentials


def jwt_claims(token: str) -> dict[str, Any]:
    """Unverified claims, only to report expiry and plan; never trusted for anything."""
    try:
        payload = token.split(".")[1]
        return json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    except (IndexError, ValueError):
        return {}


class CheckStore(OpenAICodexCredentialSource):
    """The script's own credential copy, kept in sync with the Codex CLI's file after refreshes."""

    def __init__(self, path: Path, cli: Path | None, report: Report) -> None:
        self.path, self.cli, self.report = path, cli, report
        self.loads = 0
        self.saves: list[str] = []
        self.corrupt_next_load = False

    async def load(self) -> OpenAICodexCredentials:
        self.loads += 1
        data = json.loads(self.path.read_text(encoding="utf-8"))
        credentials = OpenAICodexCredentials(**data)
        if self.corrupt_next_load:
            # Forces a 401, so the provider must refresh and call save().
            self.corrupt_next_load = False
            return OpenAICodexCredentials(
                access_token="not-a-valid-token",
                refresh_token=credentials.refresh_token,
                account_id=credentials.account_id,
            )
        return credentials

    async def save(self, credentials: OpenAICodexCredentials) -> None:
        SECRETS.extend([credentials.access_token, credentials.refresh_token])
        write_private(self.path, asdict(credentials))
        self.saves.append(datetime.now(UTC).isoformat())
        if self.cli and self.cli.exists():
            backup = self.cli.with_suffix(self.cli.suffix + ".before-ai-check")
            if not backup.exists():
                shutil.copy2(self.cli, backup)
            data = json.loads(self.cli.read_text(encoding="utf-8"))
            tokens = data.setdefault("tokens", {})
            tokens.update(
                access_token=credentials.access_token,
                refresh_token=credentials.refresh_token,
                account_id=credentials.account_id,
            )
            data["last_refresh"] = datetime.now(UTC).isoformat()
            write_private(self.cli, data)


def write_private(path: Path, data: dict[str, Any]) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(data, indent=2), encoding="utf-8")
    try:
        os.chmod(temporary, 0o600)
    except OSError:
        pass
    temporary.replace(path)


def seed_store(store: Path, auth: Path | None) -> OpenAICodexCredentials:
    if store.exists():
        credentials = OpenAICodexCredentials(**json.loads(store.read_text(encoding="utf-8")))
    elif auth and auth.exists():
        credentials = OpenAICodexCredentials.from_codex_cli_auth(json.loads(auth.read_text(encoding="utf-8")))
        write_private(store, asdict(credentials))
    else:
        raise SystemExit(f"No credentials: {store} doesn't exist and --auth {auth} wasn't found. Run `codex login` first.")
    SECRETS.extend([credentials.access_token, credentials.refresh_token])
    return credentials


def provider_for(store: CheckStore, report: Report) -> OpenAICodexProvider:
    async def record(response: httpx2.Response) -> None:
        path = response.request.url.path
        kept = {
            name: value
            for name, value in response.headers.items()
            if any(hint in name.lower() for hint in HEADER_HINTS)
            and not any(block in name.lower() for block in HEADER_BLOCK)
        }
        report.headers.update(kept)
        report.responses.append(
            {"at": round(time.perf_counter() - STARTED, 3), "method": response.request.method, "path": path, "status": response.status_code}
        )

    client = httpx2.AsyncClient(timeout=httpx2.Timeout(180, connect=20), event_hooks={"response": [record]})
    return OpenAICodexProvider(credential_source=store, http_client=client)


# ---------------------------------------------------------------- checks


class Change(BaseModel):
    id: int = Field(description="The id of the message being rewritten")
    text: str = Field(description="Its new text")


class Rewrite(BaseModel):
    """Which message gets which new text. Messages that don't change are left out."""

    changes: list[Change]


MESSAGES = [{"id": 1, "text": "dog"}, {"id": 2, "text": "cat"}, {"id": 3, "text": "bird"}]
EXPECTED = {1: "dog - 4", 2: "cat - 4", 3: "bird - 2"}
REWRITE_PROMPT = (
    "Rewrite each message: add how many legs the animal has, in the form `dog - 4`.\n\n"
    + json.dumps(MESSAGES)
)
REWRITE_INSTRUCTIONS = "You edit a user's notes. Return only the changed messages, by id. Keep their wording otherwise."


def normalise(text: str) -> str:
    return " ".join(text.lower().replace("–", "-").replace("—", "-").split())


def usage_of(result) -> dict[str, Any]:
    usage = result.usage
    return {key: value for key, value in asdict(usage).items() if value} if hasattr(usage, "__dataclass_fields__") else {"repr": repr(usage)}


def part_kinds(messages) -> dict[str, int]:
    counts: dict[str, int] = {}
    for message in messages:
        for part in getattr(message, "parts", []):
            counts[type(part).__name__] = counts.get(type(part).__name__, 0) + 1
    return counts


class Checks:
    def __init__(self, args, report: Report, store: CheckStore) -> None:
        self.args, self.report, self.store = args, report, store
        self.provider = provider_for(store, report)
        self.model_name: str | None = args.model

    def model(self, name: str | None = None, **settings) -> OpenAICodexModel:
        chosen = name or self.model_name
        if not chosen:
            raise Skip("no model: pass --model, or the model list check must find one")
        return OpenAICodexModel(chosen, provider=self.provider, settings=OpenAIResponsesModelSettings(**settings) if settings else None)

    async def environment(self):
        return {
            "summary": f"Python {platform.python_version()} · pydantic-ai {pydantic_ai.__version__} · {platform.system()} {platform.machine()}",
            "python": sys.version,
            "pydantic_ai": pydantic_ai.__version__,
            "platform": platform.platform(),
            "cpus": os.cpu_count(),
            "memory_total_mb": round(psutil.virtual_memory().total / 2**20),
            "rss_before_import_mb": round(RSS_BEFORE_IMPORT / 2**20, 1),
            "rss_after_import_mb": round(RSS_AFTER_IMPORT / 2**20, 1),
            "import_seconds": round(time.perf_counter() - STARTED, 2),
        }

    async def credentials(self):
        data = json.loads(self.store.path.read_text(encoding="utf-8"))
        access = jwt_claims(data["access_token"])
        auth = access.get("https://api.openai.com/auth", {})
        expires = access.get("exp")
        account = data.get("account_id", "")
        return {
            "summary": f"account …{account[-6:]} · plan {auth.get('chatgpt_plan_type', 'unknown')} · token expires {datetime.fromtimestamp(expires, UTC).isoformat() if expires else 'unknown'}",
            "account_id_tail": account[-6:],
            "plan_type": auth.get("chatgpt_plan_type"),
            "access_token_expires_at": datetime.fromtimestamp(expires, UTC).isoformat() if expires else None,
            "access_token_claim_keys": sorted(access.keys()),
            "auth_claim_keys": sorted(auth.keys()),
        }

    async def models(self):
        found: dict[str, Any] = {}
        try:
            listed = await self.provider.client.models.list()
            found["sdk"] = [item.id for item in listed.data]
        except Exception as error:  # noqa: BLE001
            found["sdk_error"] = describe(error)
        # The Codex CLI asks this endpoint for its model list; the shape isn't documented and
        # the list depends on the client version, so every version's answer is recorded.
        best: list[str] = []
        found["by_version"] = {}
        for version in CLIENT_VERSIONS:
            try:
                response = await self.provider.client._client.get(f"{CODEX_BASE}/models", params={"client_version": version})
                ids: list[str] = []
                if response.status_code == 200:
                    body = response.json()
                    entries = body.get("models", body.get("data", [])) if isinstance(body, dict) else body
                    ids = [entry.get("slug") or entry.get("id") for entry in entries if isinstance(entry, dict)]
                    found.setdefault("model_details", {}).update(
                        {
                            entry.get("slug"): {
                                key: entry.get(key)
                                for key in (
                                    "display_name", "description", "context_window", "max_context_window",
                                    "input_modalities", "default_reasoning_level", "supported_reasoning_levels",
                                    "web_search_tool_type", "supports_parallel_tool_calls", "visibility", "priority",
                                )
                            }
                            for entry in entries
                            if isinstance(entry, dict)
                        }
                    )
                found["by_version"][version] = {"status": response.status_code, "models": ids}
                if len(ids) > len(best):
                    best = ids
            except Exception as error:  # noqa: BLE001
                found["by_version"][version] = {"error": describe(error)["message"][:300]}
        found["raw_ids"] = best
        ids = found.get("sdk") or found.get("raw_ids") or []
        if not self.model_name and ids:
            self.model_name = ids[0]
            found["chosen"] = self.model_name
        found["summary"] = f"{len(ids)} models: {', '.join(map(str, ids[:8]))}" if ids else "no model list available"
        return found

    async def text_stream(self):
        agent = Agent(self.model(), instructions="Answer in one short sentence.")
        began = time.perf_counter()
        first = None
        chunks = 0
        async with agent.run_stream("Say hello and name the day of the week it is for you.") as result:
            async for _ in result.stream_text(delta=True, debounce_by=None):
                chunks += 1
                first = first or time.perf_counter() - began
            text = await result.get_output()
        return {
            "summary": f"first text after {first or 0:.2f}s, {chunks} chunks: {text[:60]!r}",
            "first_chunk_seconds": round(first or 0, 3),
            "chunks": chunks,
            "text": text,
            "usage": usage_of(result),
        }

    async def rewrite(self, mode: str):
        output = {"tool": ToolOutput(Rewrite), "native": NativeOutput(Rewrite), "prompted": PromptedOutput(Rewrite)}[mode]
        agent = Agent(self.model(), output_type=output, instructions=REWRITE_INSTRUCTIONS)
        began = time.perf_counter()
        partials: list[float] = []
        snapshots: list[int] = []
        async with agent.run_stream(REWRITE_PROMPT) as result:
            async for partial in result.stream_output(debounce_by=None):
                partials.append(round(time.perf_counter() - began, 3))
                snapshots.append(sum(len(change.text) for change in partial.changes))
            final: Rewrite = await result.get_output()
        got = {change.id: change.text for change in final.changes}
        correct = all(normalise(got.get(key, "")) == normalise(value) for key, value in EXPECTED.items())
        return {
            "_failed": not correct,
            "summary": f"{'correct' if correct else 'WRONG'} · {len(partials)} partial updates, first at {partials[0] if partials else 'n/a'}s · {got}",
            "result": got,
            "ids_valid": set(got) <= {item["id"] for item in MESSAGES},
            "partial_updates": len(partials),
            "partial_times": partials[:40],
            "partial_text_lengths": snapshots[:40],
            "streams_gradually": len(set(snapshots)) > 2,
            "usage": usage_of(result),
            "message_parts": part_kinds(result.all_messages()),
        }

    async def thinking(self):
        timings: dict[str, Any] = {}
        for effort in ("none", "minimal", "low", "medium", "high", "xhigh"):
            agent = Agent(self.model(openai_reasoning_effort=effort), instructions="Answer with just the number.")
            began = time.perf_counter()
            try:
                result = await agent.run("A train leaves at 09:47 and arrives at 13:05. How many minutes is the trip?")
                timings[effort] = {"seconds": round(time.perf_counter() - began, 2), "answer": result.output.strip(), "usage": usage_of(result)}
            except Exception as error:  # noqa: BLE001
                timings[effort] = {"error": describe(error)["message"][:300], "type": type(error).__name__}
        worked = [effort for effort, value in timings.items() if "seconds" in value]
        return {"summary": f"accepted: {', '.join(worked) or 'none'}", "efforts": timings, "_failed": not worked}

    async def history(self):
        agent = Agent(self.model(), instructions="Be brief.")
        first = await agent.run("Remember these three words: lantern, pebble, orchid. Reply with OK.")
        stored = ModelMessagesTypeAdapter.dump_json(first.all_messages())
        restored = ModelMessagesTypeAdapter.validate_json(stored)
        second = await agent.run("What was the second word?", message_history=restored)
        correct = "pebble" in second.output.lower()
        return {
            "_failed": not correct,
            "summary": f"{'remembered' if correct else 'FORGOT'} after a save and reload: {second.output.strip()[:60]!r}",
            "stored_bytes": len(stored),
            "second_answer": second.output,
            "usage_turn_2": usage_of(second),
        }

    async def native_tool(self, tool, question: str, expect: str):
        agent = Agent(self.model(), capabilities=[NativeTool(tool)], instructions="Use the tool, then answer in one sentence.")
        result = await agent.run(question)
        parts = part_kinds(result.all_messages())
        used = any("NativeTool" in name for name in parts)
        return {
            "_failed": not used,
            "summary": f"{'tool used' if used else 'NO tool call'} · {result.output.strip()[:80]!r}",
            "answer": result.output,
            "mentions_expected": expect.lower() in result.output.lower(),
            "message_parts": parts,
            "usage": usage_of(result),
        }

    async def image(self):
        agent = Agent(self.model(), instructions="Answer with one word.")
        result = await agent.run(["What colour is this image?", BinaryContent(data=RED_PNG, media_type="image/png")])
        correct = "red" in result.output.lower()
        return {"_failed": not correct, "summary": repr(result.output.strip()[:40]), "answer": result.output, "usage": usage_of(result)}

    async def parallel(self):
        agent = Agent(self.model(), instructions="Answer with just the number.")

        async def one(index: int):
            began = time.perf_counter()
            result = await agent.run(f"What is {index} + {index}?")
            return round(time.perf_counter() - began, 2), result.output.strip()

        results = await asyncio.gather(*(one(index) for index in range(1, 4)), return_exceptions=True)
        clean = [value if not isinstance(value, BaseException) else describe(value)["type"] for value in results]
        return {"summary": f"3 at once: {clean}", "results": [str(value) for value in clean], "_failed": any(isinstance(v, BaseException) for v in results)}

    async def bad_model(self):
        agent = Agent(OpenAICodexModel("noted-model-that-does-not-exist", provider=self.provider))
        try:
            await agent.run("hi")
        except Exception as error:  # noqa: BLE001
            info = describe(error)
            return {"summary": f"{info['type']} (status {info.get('status_code', '?')})", "error": info}
        return {"_failed": True, "summary": "an unknown model was accepted"}

    async def refresh(self):
        if not self.args.refresh_test:
            raise Skip("pass --refresh-test (uses up one refresh token; the CLI file is kept in sync)")
        saves_before = len(self.store.saves)
        restarted = CheckStore(self.store.path, self.store.cli, self.report)
        # A fresh provider models a server restart: it loads from storage, gets a 401, refreshes.
        fresh = provider_for(restarted, self.report)
        restarted.corrupt_next_load = True
        agent = Agent(OpenAICodexModel(self.model_name, provider=fresh), instructions="Reply with OK.")
        began = time.perf_counter()
        result = await agent.run("Say OK.")
        refreshed = len(restarted.saves) > 0
        # A second restart must work from what was saved, with no refresh at all.
        again = CheckStore(self.store.path, self.store.cli, self.report)
        second = await Agent(OpenAICodexModel(self.model_name, provider=provider_for(again, self.report))).run("Say OK.")
        cli_ok = None
        if self.store.cli and self.store.cli.exists():
            cli = json.loads(self.store.cli.read_text(encoding="utf-8")).get("tokens", {})
            stored = json.loads(self.store.path.read_text(encoding="utf-8"))
            cli_ok = cli.get("refresh_token") == stored["refresh_token"]
        return {
            "_failed": not (refreshed and second.output),
            "summary": f"refreshed and saved: {refreshed} · works after restart: {bool(second.output)} · CLI file in sync: {cli_ok}",
            "seconds_with_refresh": round(time.perf_counter() - began, 2),
            "saves": len(restarted.saves),
            "loads": restarted.loads,
            "unrelated_saves_before": saves_before,
            "cli_in_sync": cli_ok,
            "first_answer": result.output,
            "second_restart_saves": len(again.saves),
        }


# ---------------------------------------------------------------- main


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--auth", type=Path, default=Path(os.getenv("CODEX_HOME") or Path.home() / ".codex") / "auth.json",
                        help="The Codex CLI's auth.json to seed from (default: ~/.codex/auth.json)")
    parser.add_argument("--store", type=Path, default=Path("ai-check-credentials.json"),
                        help="The script's own credential copy (created from --auth on first run)")
    parser.add_argument("--model", help="Model to test; default: the first one the model list reports")
    parser.add_argument("--report", type=Path, default=Path("ai-check-report.json"))
    parser.add_argument("--refresh-test", action="store_true", help="Force a token refresh and a restart")
    parser.add_argument("--no-sync-cli", action="store_true", help="Don't write refreshed tokens back into --auth")
    parser.add_argument("--skip", nargs="*", default=[], help="Checks to skip, e.g. --skip web image thinking")
    args = parser.parse_args()

    seed_store(args.store, args.auth)
    report = Report()
    store = CheckStore(args.store, None if args.no_sync_cli else args.auth, report)
    checks = Checks(args, report, store)
    print(f"Noted AI check · {datetime.now(UTC).isoformat(timespec='seconds')} · report: {args.report}\n")

    plan = [
        ("environment", checks.environment),
        ("credentials", checks.credentials),
        ("models", checks.models),
        ("text", checks.text_stream),
        ("rewrite-tool", checks.rewrite, "tool"),
        ("rewrite-native", checks.rewrite, "native"),
        ("rewrite-prompted", checks.rewrite, "prompted"),
        ("thinking", checks.thinking),
        ("history", checks.history),
        ("web", checks.native_tool, WebSearchTool(), "Who won the most recent Formula 1 race? Include the date.", "202"),
        ("fetch", checks.native_tool, WebFetchTool(), "Fetch https://example.com and tell me its page title.", "Example Domain"),
        ("image", checks.image),
        ("parallel", checks.parallel),
        ("bad-model", checks.bad_model),
        ("refresh", checks.refresh),
    ]
    for name, step, *extra in plan:
        if name in args.skip or name.split("-")[0] in args.skip:
            report.checks.append(Check(name, details={"reason": "skipped by --skip"}))
            print(f"  SKIP  {name:<34}   ----   skipped by --skip")
            continue
        await report.run(name, step, *extra)

    report.sample_memory()
    summary = {
        "finished_at": datetime.now(UTC).isoformat(),
        "seconds": round(time.perf_counter() - STARTED, 2),
        "model": checks.model_name,
        "memory_mb": {
            "before_import": round(RSS_BEFORE_IMPORT / 2**20, 1),
            "after_import": round(RSS_AFTER_IMPORT / 2**20, 1),
            "peak": round(report.peak_rss / 2**20, 1),
        },
        "counts": {status: sum(check.status == status for check in report.checks) for status in ("PASS", "FAIL", "SKIP")},
        "checks": [asdict(check) for check in report.checks],
        "response_headers": report.headers,
        "responses": report.responses,
        "credential_saves": len(store.saves),
    }
    args.report.write_text(redact(json.dumps(summary, indent=2, default=str)), encoding="utf-8")
    counts = summary["counts"]
    print(
        f"\n{counts['PASS']} passed · {counts['FAIL']} failed · {counts['SKIP']} skipped · "
        f"peak memory {summary['memory_mb']['peak']} MB (imports {summary['memory_mb']['after_import'] - summary['memory_mb']['before_import']:.0f} MB) · "
        f"{summary['seconds']}s\nFull results: {args.report.resolve()}"
    )
    return 1 if counts["FAIL"] else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
