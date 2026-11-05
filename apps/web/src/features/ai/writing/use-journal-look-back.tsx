import { useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Copy, Save, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../../../components/ui/button";
import { Markdown } from "../../notes/components/markdown";
import { journalsApi } from "../../journals/api";
import type { JournalSummary } from "../../journals/types";
import type { Channel } from "../../workspaces/types";
import { aiApi, type AiPrompt } from "../api";
import { useAiPrompts, useAiStatus } from "../queries";
import { useAiRun } from "../use-ai-run";
import { AiSources, AiThinking } from "../components/ai-feedback";
import { AiWritingError } from "./ai-writing-error";
import { PromptChooser } from "./prompt-chooser";
import { writingPrompts } from "./prompts";

type Period = "week" | "month" | "pick";

export function useJournalLookBack({
  channel,
  entries,
  onSelect,
}: {
  channel: Channel;
  entries: JournalSummary[];
  onSelect: (id: string) => void;
}) {
  const status = useAiStatus();
  const prompts = useAiPrompts(Boolean(status.data?.connected));
  const stream = useAiRun();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [period, setPeriod] = useState<Period>("week");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [extra, setExtra] = useState<JournalSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [sent, setSent] = useState<JournalSummary[]>([]);
  const [sentPeriod, setSentPeriod] = useState<Period>("week");
  const [saving, setSaving] = useState(false);
  const generation = useRef(0);
  const all = [
    ...new Map(
      [...entries, ...extra].map((entry) => [entry.id, entry]),
    ).values(),
  ];
  const now = new Date();
  const since =
    period === "month"
      ? new Date(now.getFullYear(), now.getMonth(), 1)
      : new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
  const selected = all.filter((entry) =>
    period === "pick"
      ? picked.has(entry.id)
      : new Date(entry.created_at) >= since,
  );
  const marked = new Set(selected.map((entry) => entry.id));
  const result = stream.result;

  async function choose(next: Period) {
    setPeriod(next);
    setError(null);
    generation.current++;
    setLoading(false);
    if (next === "pick") return;
    const ticket = ++generation.current;
    const date = new Date();
    const cutoff =
      next === "month"
        ? new Date(date.getFullYear(), date.getMonth(), 1)
        : new Date(date.getFullYear(), date.getMonth(), date.getDate() - 6);
    setLoading(true);
    try {
      let offset = 0;
      const rows: JournalSummary[] = [];
      for (;;) {
        const page = await journalsApi.list(channel.id, offset);
        if (ticket !== generation.current) return;
        rows.push(...page);
        if (
          page.length < 50 ||
          page.some((entry) => new Date(entry.created_at) < cutoff)
        )
          break;
        offset += page.length;
        if (
          rows.filter((entry) => new Date(entry.created_at) >= cutoff).length >
          60
        )
          break;
      }
      setExtra(rows);
    } catch (failure) {
      if (ticket === generation.current) setError((failure as Error).message);
    } finally {
      if (ticket === generation.current) setLoading(false);
    }
  }
  function toggle(id: string) {
    if (!open || period !== "pick" || result) return false;
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else if (next.size < 60) next.add(id);
      else toast.error("Choose up to 60 entries.");
      return next;
    });
    return true;
  }
  function ask(saved?: AiPrompt) {
    if (loading || !selected.length) return;
    if (selected.length > 60) {
      setError(
        "Choose up to 60 entries. Use Pick entries for a smaller selection.",
      );
      return;
    }
    setSent(selected);
    setSentPeriod(period);
    setError(null);
    void stream.start(
      {
        place: "journals",
        channel_id: channel.id,
        kind: "answer",
        entry_ids: selected.map((entry) => entry.id),
        ...(saved ? { prompt_id: saved.id } : { instructions: prompt.trim() }),
      },
      saved?.name,
    );
  }
  async function save() {
    if (!result || result.stage !== "done" || saving) return;
    setSaving(true);
    try {
      const date = new Date();
      date.setDate(date.getDate() - 6);
      const title = (
        sentPeriod === "week"
          ? `Week of ${date.toLocaleDateString(undefined, { day: "numeric", month: "long" })}`
          : sentPeriod === "month"
            ? `${new Date().toLocaleDateString(undefined, { month: "long" })} review`
            : result.name
      ).slice(0, 120);
      const created = await journalsApi.create(channel.id, title);
      const entry = await journalsApi.update(created.id, {
        title,
        content: result.text,
        revision: created.revision,
      });
      client.setQueryData(["journal-entry", entry.id], entry);
      void client.invalidateQueries({ queryKey: ["journals", channel.id] });
      if (result.id)
        void aiApi.setOutcome(result.id, "saved").catch(() => undefined);
      setOpen(false);
      onSelect(entry.id);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setSaving(false);
    }
  }
  const button = status.data?.connected && (
    <Popover.Root
      modal={false}
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (value) {
          stream.cancel();
          void choose(period);
        } else {
          generation.current++;
          setLoading(false);
          stream.cancel();
        }
      }}
    >
      <Popover.Trigger asChild>
        <button
          className="ai-tools-button"
          type="button"
          disabled={!navigator.onLine}
          title={!navigator.onLine ? "AI needs a connection" : undefined}
        >
          <Sparkles size={14} />
          Ask AI
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="ask-ai-popover ai-writing-popover ai-look-back"
          aria-label="Look back"
          side="bottom"
          align="end"
          sideOffset={8}
          collisionPadding={12}
          onInteractOutside={(event) => {
            if (
              period === "pick" &&
              !result &&
              event.target instanceof Element &&
              event.target.closest(".journal-entry-row, [data-ai-load-entries]")
            )
              event.preventDefault();
          }}
        >
          <div className="ask-ai-heading">
            <Sparkles size={15} />
            <strong>Look back</strong>
            <span className="ai-scope-chip">
              {result ? sent.length : selected.length} entries
            </span>
          </div>
          {result ? (
            <>
              <AiThinking result={result} />
              {result.error ? (
                <AiWritingError message={result.error} code={result.code} />
              ) : (
                <Markdown content={result.text} />
              )}
              <AiSources sources={result.sources} />
              <div className="ai-from-entries">
                <span>From</span>
                {sent.map((entry) => (
                  <button
                    type="button"
                    key={entry.id}
                    onClick={() => onSelect(entry.id)}
                  >
                    {entry.title}
                  </button>
                ))}
              </div>
              <div className="ai-answer-actions">
                <Button
                  size="small"
                  variant="ghost"
                  onClick={() => stream.cancel()}
                >
                  <ArrowLeft size={13} />
                  Ask again
                </Button>
                <Button
                  size="small"
                  variant="ghost"
                  disabled={!result.text}
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(result.text)
                      .then(() => toast.success("Copied"))
                      .catch(() => toast.error("Could not copy"))
                  }
                >
                  <Copy size={13} />
                  Copy
                </Button>
                <Button
                  size="small"
                  disabled={result.stage !== "done" || saving}
                  onClick={() => void save()}
                >
                  <Save size={13} />
                  Save as new entry
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="ai-period-options">
                {(
                  [
                    ["week", "Last 7 days"],
                    ["month", "This month"],
                    ["pick", "Pick entries"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    type="button"
                    aria-pressed={period === value}
                    key={value}
                    onClick={() => void choose(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {loading ? (
                <p className="settings-hint">Finding entries…</p>
              ) : (
                !selected.length && (
                  <p className="settings-hint">
                    {period === "pick"
                      ? "Select entries in the list."
                      : "No entries in this period."}
                  </p>
                )
              )}
              {selected.length > 60 && (
                <p className="settings-hint">
                  This period has more than 60 entries. Choose Pick entries to
                  narrow it down.
                </p>
              )}
              <fieldset
                disabled={loading || !selected.length || selected.length > 60}
              >
                <PromptChooser
                  prompts={writingPrompts(
                    prompts.data ?? [],
                    "journals",
                    false,
                    true,
                  )}
                  prompt={prompt}
                  setPrompt={setPrompt}
                  kind="answer"
                  setKind={() => undefined}
                  answerOnly
                  onAsk={ask}
                  placeholder={`Ask about ${selected.length} entries`}
                />
              </fieldset>
            </>
          )}
          {error && <AiWritingError message={error} />}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
  return {
    button,
    marked: open && !result ? marked : new Set<string>(),
    picking: open && period === "pick" && !result,
    toggle,
  };
}
