import { useEffect, useRef, useState, type RefObject } from "react";
import { Sparkles } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { journalsApi } from "../../journals/api";
import { aiApi, type AiKind, type AiPrompt, type AiRunInput } from "../api";
import { useAiPrompts, useAiStatus } from "../queries";
import { useAiRun } from "../use-ai-run";
import { matchSelection, type SourceRange } from "./selection";
import { writingPrompts } from "./prompts";
import { textareaLineTop } from "./caret-position";

interface WritingOptions {
  place: "journals" | "documents";
  channelId: string;
  title: string;
  content: string;
  onChange: (value: string) => void;
  onOpenEntry?: (id: string) => void;
  onAnswer?: (input: AiRunInput, name: string, selected: boolean) => void;
  focusChat?: () => boolean;
  flush: () => Promise<void>;
  checkSource: () => Promise<{ content: string; revision: number }>;
  revision: number;
  saveError: Error | null;
  cursor?: RefObject<number | null>;
}

interface Snapshot {
  content: string;
  range: SourceRange;
  input: AiRunInput;
  name: string;
  revision: number;
}

export function useAiWriting(options: WritingOptions) {
  const status = useAiStatus();
  const prompts = useAiPrompts(Boolean(status.data?.connected));
  const run = useAiRun();
  const client = useQueryClient();
  const latest = useRef(options);
  latest.current = options;
  const surface = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const margin = useRef<HTMLButtonElement>(null);
  const anchor = useRef({
    getBoundingClientRect: () =>
      trigger.current?.getBoundingClientRect() ?? new DOMRect(),
  });
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState<SourceRange | null>(null);
  const [position, setPosition] = useState<number | null>(null);
  const [selectedScope, setSelectedScope] = useState(false);
  const [fallback, setFallback] = useState(false);
  const [kind, setKind] = useState<AiKind>("answer");
  const [prompt, setPrompt] = useState("");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [conflict, setConflict] = useState(false);
  const [applying, setApplying] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const ownCursor = useRef<number | null>(null);
  const cursor = options.cursor ?? ownCursor;
  const editorSelection = useRef<{
    start: number;
    end: number;
    range: SourceRange;
  } | null>(null);
  const previewing = Boolean(
    snapshot &&
    run.result?.kind === "rewrite" &&
    run.result.stage !== "applied",
  );
  const connected = Boolean(status.data?.connected);
  const stop = useRef(run.cancel);
  stop.current = run.cancel;

  useEffect(() => {
    if (connected) return;
    stop.current();
    setOpen(false);
    setSnapshot(null);
  }, [connected]);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  useEffect(() => {
    function capture() {
      const root = surface.current;
      if (!root || open || previewing) return;
      const input = root.querySelector("textarea");
      const source = latest.current.content;
      if (input && document.activeElement === input) {
        cursor.current =
          editorSelection.current?.range.end ?? input.selectionEnd;
        const start = input.selectionStart,
          end = input.selectionEnd;
        if (start === end) {
          setSelection(null);
          setPosition(null);
          return;
        }
        const remembered = editorSelection.current;
        const range =
          remembered && remembered.start === start && remembered.end === end
            ? remembered.range
            : source === input.value
              ? { start, end }
              : matchSelection(source, input.value.slice(start, end), start);
        setSelection(range);
        setFallback(!range);
        setPosition(Math.max(0, textareaLineTop(input, start)));
        return;
      }
      const selected = window.getSelection();
      if (
        !selected?.rangeCount ||
        selected.isCollapsed ||
        !root.contains(selected.anchorNode) ||
        !root.contains(selected.focusNode)
      ) {
        setPosition(null);
        setSelection(null);
        return;
      }
      const range = selected.getRangeAt(0);
      const reading = root.querySelector(".journal-reading") ?? root;
      if (!reading.contains(range.commonAncestorContainer)) return;
      const before = document.createRange();
      before.selectNodeContents(reading);
      before.setEnd(range.startContainer, range.startOffset);
      const mapped = matchSelection(
        source,
        selected.toString(),
        before.toString().replace(/\s+/g, " ").trim().length,
      );
      const rect = range.getClientRects()[0];
      setSelection(mapped);
      setFallback(!mapped);
      setPosition(
        rect
          ? Math.max(
              0,
              rect.top - root.getBoundingClientRect().top + root.scrollTop,
            )
          : null,
      );
    }
    document.addEventListener("selectionchange", capture);
    document.addEventListener("select", capture, true);
    surface.current?.addEventListener("scroll", capture, true);
    const root = surface.current;
    return () => {
      document.removeEventListener("selectionchange", capture);
      document.removeEventListener("select", capture, true);
      root?.removeEventListener("scroll", capture, true);
    };
  }, [open, previewing, cursor]);

  function cancel() {
    const id = run.result?.id;
    run.cancel();
    setSnapshot(null);
    setConflict(false);
    setOpen(false);
    if (id) void aiApi.setOutcome(id, "cancelled").catch(() => undefined);
  }

  function onEditorSelection(range: SourceRange, input: HTMLTextAreaElement) {
    editorSelection.current = {
      start: input.selectionStart,
      end: input.selectionEnd,
      range,
    };
    cursor.current = range.end;
    if (open || previewing) return;
    setSelection(range.start === range.end ? null : range);
    setFallback(false);
    setPosition(
      range.start === range.end
        ? null
        : Math.max(0, textareaLineTop(input, input.selectionStart)),
    );
  }

  useEffect(() => {
    if (!previewing) return;
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cancel();
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        void apply();
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  });

  function show(fromMargin = false) {
    if (options.focusChat?.()) return;
    anchor.current = {
      getBoundingClientRect: () =>
        (fromMargin
          ? margin.current
          : trigger.current
        )?.getBoundingClientRect() ?? new DOMRect(),
    };
    setSelectedScope(Boolean(selection));
    setKind(selection ? "rewrite" : "answer");
    if (!previewing) {
      run.cancel();
      setSnapshot(null);
    }
    setOpen(true);
  }

  async function ask(saved?: AiPrompt) {
    const current = latest.current;
    const requestedKind = saved?.kind ?? kind;
    const range =
      selectedScope && selection
        ? selection
        : { start: 0, end: current.content.length };
    const text = current.content.slice(range.start, range.end);
    const input: AiRunInput = {
      place: current.place,
      channel_id: current.channelId,
      text: text || `Title: ${current.title}`,
      where: current.title.slice(0, 120),
      kind: requestedKind,
      ...(saved
        ? { prompt_id: saved.id, instructions: saved.instructions }
        : { instructions: prompt.trim() }),
    };
    if (!saved && !prompt.trim()) return;
    const name = saved?.name ?? "Custom prompt";
    setConflict(false);
    if (requestedKind === "answer" && current.onAnswer) {
      setOpen(false);
      current.onAnswer(input, name, selectedScope);
      return;
    }
    setSnapshot({
      content: current.content,
      range,
      input,
      name,
      revision: current.revision,
    });
    if (requestedKind === "rewrite") setOpen(false);
    void run.start(input, name);
  }

  async function replace(before: string, after: string, label: string) {
    if (latest.current.content !== before || latest.current.saveError)
      throw new Error(
        "This entry changed on another device. Ask again before applying.",
      );
    await latest.current.flush();
    const saved = await latest.current.checkSource();
    if (saved.content !== before || latest.current.content !== before)
      throw new Error(
        "This entry changed on another device. Ask again before applying.",
      );
    latest.current.onChange(after);
    run.applied();
    setSnapshot(null);
    setOpen(false);
    toast.success(label, {
      action: {
        label: "Undo",
        onClick: () => {
          if (latest.current.content !== after) {
            toast.error(
              "This writing has changed since. Undo is no longer available.",
            );
            return;
          }
          latest.current.onChange(before);
        },
      },
    });
  }

  async function apply() {
    if (!snapshot || run.result?.stage !== "done" || applying) return;
    setApplying(true);
    try {
      const after =
        snapshot.content.slice(0, snapshot.range.start) +
        run.result.text +
        snapshot.content.slice(snapshot.range.end);
      await replace(
        snapshot.content,
        after,
        options.place === "journals" ? "Entry updated" : "Document updated",
      );
    } catch (error) {
      setConflict(true);
      toast.error((error as Error).message);
    } finally {
      setApplying(false);
    }
  }

  async function addAnswer() {
    if (!run.result || !snapshot) return;
    const quoted = run.result.text
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
    try {
      await replace(
        snapshot.content,
        snapshot.content + (snapshot.content ? "\n\n" : "") + quoted,
        "Added to entry",
      );
    } catch (error) {
      setConflict(true);
      toast.error((error as Error).message);
    }
  }

  async function saveAnswer() {
    if (!run.result) return;
    try {
      const title = (
        run.result.text
          .split("\n")
          .find((line) => line.trim())
          ?.replace(/^#+\s*/, "") || run.result.name
      ).slice(0, 120);
      const created = await journalsApi.create(options.channelId, title);
      const entry = await journalsApi.update(created.id, {
        title,
        content: run.result.text,
        revision: created.revision,
      });
      client.setQueryData(["journal-entry", entry.id], entry);
      void client.invalidateQueries({
        queryKey: ["journals", options.channelId],
      });
      if (run.result.id)
        void aiApi.setOutcome(run.result.id, "saved").catch(() => undefined);
      setOpen(false);
      options.onOpenEntry?.(entry.id);
    } catch (error) {
      toast.error((error as Error).message);
    }
  }

  const button = connected && (
    <button
      ref={trigger}
      type="button"
      className="ai-tools-button"
      disabled={!online || previewing}
      title={!online ? "AI needs a connection" : undefined}
      onPointerDown={(event) => event.preventDefault()}
      onClick={() => show()}
      aria-haspopup="dialog"
      aria-expanded={open}
    >
      <Sparkles size={14} />
      Ask AI
    </button>
  );
  return {
    options,
    connected,
    online,
    button,
    surface,
    margin,
    anchor,
    open,
    setOpen,
    selection,
    position,
    selectedScope,
    setSelectedScope,
    fallback,
    kind,
    setKind,
    prompt,
    setPrompt,
    snapshot,
    conflict,
    previewing,
    applying,
    cursor,
    onEditorSelection,
    run,
    show,
    ask,
    apply,
    cancel,
    addAnswer,
    saveAnswer,
    prompts: writingPrompts(
      prompts.data ?? [],
      options.place,
      !options.content.trim(),
    ),
  };
}

export type AiWritingController = ReturnType<typeof useAiWriting>;
