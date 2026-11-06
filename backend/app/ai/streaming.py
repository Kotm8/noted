import json
import re
from dataclasses import asdict, is_dataclass
from time import monotonic
from typing import Any
from urllib.parse import urlsplit

from pydantic_ai.messages import (
    FunctionToolCallEvent,
    FunctionToolResultEvent,
    NativeToolCallPart,
    NativeToolReturnPart,
    PartDeltaEvent,
    PartEndEvent,
    PartStartEvent,
    TextPart,
    TextPartDelta,
    ThinkingPart,
    ThinkingPartDelta,
    ToolCallPart,
    ToolCallPartDelta,
)
from pydantic_core import from_json, to_jsonable_python


def event(name: str, **values: Any) -> str:
    return json.dumps({"type": name, **values}, ensure_ascii=False, default=str) + "\n"


class StreamState:
    def __init__(self) -> None:
        self.started = monotonic()
        self.thought_seconds: float | None = None
        self.text: dict[int, str] = {}
        self.headings: dict[int, str] = {}
        self.cited: dict[str, dict[str, str]] = {}
        self.found: dict[str, dict[str, str]] = {}
        self.searches: dict[str, str] = {}
        self.searched = False
        self.noted_searched = False
        self.usage: dict[str, Any] = {}
        self.output = ""

    @property
    def sources(self) -> list[dict[str, str]]:
        return list(
            {
                **self.cited,
                **{url: page for url, page in self.found.items() if url not in self.cited},
            }.values()
        )

    def add_source(self, value: Any, *, cited: bool = False) -> None:
        data = asdict(value) if is_dataclass(value) and not isinstance(value, type) else value
        if not isinstance(data, dict):
            return
        url = data.get("url")
        if not isinstance(url, str):
            return
        # Search results sometimes end a URL with the sentence's punctuation.
        url = url.rstrip(".,;:")
        parsed = urlsplit(url)
        internal = (
            not parsed.scheme
            and not parsed.netloc
            and bool(re.fullmatch(r"/w/[0-9a-f-]{36}/c/[0-9a-f-]{36}", parsed.path))
        )
        if not internal and (parsed.scheme not in ("http", "https") or not parsed.hostname):
            return
        key = url.rstrip("/")
        target = self.cited if cited else self.found
        target[key] = {"url": url, "title": str(data.get("title") or parsed.hostname)}
        if internal:
            target[key]["kind"] = str(data.get("kind", "message"))

    def citations(self, citations: Any) -> None:
        for citation in citations or []:
            for source in citation.sources:
                self.add_source(source, cited=True)

    def writing(self) -> dict[str, Any]:
        if self.thought_seconds is None:
            self.thought_seconds = round(monotonic() - self.started, 2)
        self.output = "".join(self.text[index] for index in sorted(self.text))
        return {"type": "text", "text": self.output, "thought_seconds": self.thought_seconds}

    def consume(self, item: Any) -> list[dict[str, Any]]:
        events: list[dict[str, Any]] = []
        before = self.sources
        if isinstance(item, FunctionToolCallEvent) and item.part.tool_name in (
            "search_noted",
            "read_noted",
            "view_noted_image",
        ):
            self.noted_searched = True
            tool_args = item.part.args_as_dict()
            events.append(
                {
                    "type": "search",
                    "scope": "noted",
                    "action": {
                        "search_noted": "search",
                        "read_noted": "read",
                        "view_noted_image": "image",
                    }[item.part.tool_name],
                    "query": str(tool_args.get("query") or tool_args.get("identifier") or ""),
                }
            )
        elif isinstance(item, FunctionToolCallEvent) and item.part.tool_name in (
            "remember",
            "forget",
        ):
            tool_args = item.part.args_as_dict()
            events.append(
                {
                    "type": "memory",
                    "action": item.part.tool_name,
                    "text": str(tool_args.get("fact") or ""),
                }
            )
        elif isinstance(item, FunctionToolResultEvent):
            metadata = item.part.metadata
            if isinstance(metadata, dict):
                for source in metadata.get("noted_sources", []):
                    self.add_source(source)
        elif isinstance(item, PartStartEvent | PartEndEvent):
            part = item.part
            if isinstance(part, TextPart):
                self.text[item.index] = part.content
                self.citations(part.citations)
                if part.content:
                    events.append(self.writing())
            elif isinstance(part, ThinkingPart) and part.content:
                self.headings[item.index] = part.content
                events.append(
                    {"type": "thinking", "heading": part.content.splitlines()[0].strip("* ")[:160]}
                )
            elif isinstance(part, NativeToolCallPart) and part.tool_name == "web_search":
                self.searched = True
                args = part.args
                if isinstance(args, str):
                    try:
                        args = json.loads(args)
                    except ValueError:
                        args = {}
                query = str((args or {}).get("query") or "")
                if self.searches.get(part.tool_call_id) != query:
                    self.searches[part.tool_call_id] = query
                    events.append({"type": "search", "query": query})
            elif isinstance(part, NativeToolReturnPart) and part.tool_name == "web_search":
                self.searched = True
                if isinstance(part.content, dict):
                    sources = part.content.get("sources", [])
                    if isinstance(sources, list):
                        for source in sources:
                            self.add_source(source)
        elif isinstance(item, PartDeltaEvent):
            delta = item.delta
            if isinstance(delta, TextPartDelta):
                self.text[item.index] = self.text.get(item.index, "") + delta.content_delta
                self.citations(delta.citations_delta)
                if delta.content_delta:
                    events.append(self.writing())
            elif isinstance(delta, ThinkingPartDelta) and delta.content_delta:
                self.headings[item.index] = self.headings.get(item.index, "") + delta.content_delta
                events.append(
                    {
                        "type": "thinking",
                        "heading": self.headings[item.index].splitlines()[0].strip("* ")[:160],
                    }
                )
        if self.sources != before:
            events.append({"type": "sources", "sources": self.sources})
        return events

    def metadata(self) -> dict[str, Any]:
        return {
            **to_jsonable_python(self.usage),
            "sources": self.sources,
            "searched": self.searched,
            "noted_searched": self.noted_searched,
            "thought_seconds": self.thought_seconds or round(monotonic() - self.started, 2),
        }


class ExplanationStream:
    """The assistant answers through an output tool, so its explanation arrives as tool
    arguments. They're read as partial JSON while they stream, so the answer appears as
    it's written instead of all at once."""

    def __init__(self, output_tools: set[str]) -> None:
        self.output_tools = output_tools
        self.args: dict[int, str] = {}
        self.text = ""

    def consume(self, item: Any) -> str | None:
        if isinstance(item, PartStartEvent) and isinstance(item.part, ToolCallPart):
            if item.part.tool_name not in self.output_tools:
                return None
            args = item.part.args
            self.args[item.index] = args if isinstance(args, str) else json.dumps(args or {})
        elif (
            isinstance(item, PartDeltaEvent)
            and isinstance(item.delta, ToolCallPartDelta)
            and item.index in self.args
        ):
            delta = item.delta.args_delta
            if isinstance(delta, str):
                self.args[item.index] += delta
            elif isinstance(delta, dict):
                self.args[item.index] = json.dumps(delta)
        else:
            return None
        try:
            partial = from_json(self.args[item.index] or "{}", allow_partial="trailing-strings")
        except ValueError:
            return None
        text = partial.get("explanation") if isinstance(partial, dict) else None
        if not isinstance(text, str) or text == self.text:
            return None
        self.text = text
        return text
