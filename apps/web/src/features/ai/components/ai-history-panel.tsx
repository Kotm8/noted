import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../../../components/ui/button";
import { ConfirmDialog } from "../../../components/ui/confirm-dialog";
import { Notice } from "../../../components/ui/notice";
import { aiApi, type AiChange, type AiRun } from "../api";
import { AiSources } from "./ai-feedback";
import { Markdown } from "../../notes/components/markdown";
import type { CalendarProposal } from "../calendar/types";
import { dayLabel, minuteLabel } from "../../schedule/dates";

const OUTCOMES: Record<string, string> = {
  running: "Running",
  ready: "Not applied",
  applied: "Applied",
  cancelled: "Cancelled",
  saved: "Saved as note",
  reply: "Reply added",
  draft: "Used as draft",
  failed: "Failed",
  limit: "Limit reached",
};

const when = (value: string) =>
  new Date(value).toLocaleString([], {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

/** Settings › AI › History: every run, what it was asked, and what became of it. */
export function AiHistoryPanel() {
  const client = useQueryClient();
  const runs = useQuery({ queryKey: ["ai-runs"], queryFn: aiApi.runs });
  const [open, setOpen] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [clearing, setClearing] = useState(false);
  const remove = useMutation({
    mutationFn: aiApi.deleteRun,
    onSuccess: () => void client.invalidateQueries({ queryKey: ["ai-runs"] }),
  });
  const clear = useMutation({
    mutationFn: aiApi.clearRuns,
    onSuccess: () => {
      setClearing(false);
      void client.invalidateQueries({ queryKey: ["ai-runs"] });
      toast.success("History cleared");
    },
  });
  const term = search.trim().toLowerCase();
  const groups = new Map<string, AiRun[]>();
  for (const run of runs.data ?? []) {
    const key = run.conversation_id ?? run.id;
    groups.set(key, [...(groups.get(key) ?? []), run]);
  }
  const items = [...groups.values()].filter((group) =>
    group.some(
      (run) =>
        !term ||
        [run.prompt_name, run.instructions, run.where].some((value) =>
          value.toLowerCase().includes(term),
        ),
    ),
  );
  return (
    <section className="settings-panel ai-history">
      <div className="ai-prompts-heading">
        <div>
          <h2>History</h2>
          <p>Rewrites can also be undone from each message's edit history.</p>
        </div>
        <input
          className="ai-history-search"
          aria-label="Search history"
          placeholder="Search history"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      {runs.isError && <Notice tone="error">{runs.error.message}</Notice>}
      {!runs.isPending && !items.length && (
        <p className="settings-hint">
          {term ? "Nothing matches." : "No AI runs yet."}
        </p>
      )}
      <ol className="ai-runs">
        {items.map((group) => {
          const run = group[0];
          return (
            <li key={run.id} className={open === run.id ? "open" : undefined}>
              <button
                type="button"
                onClick={() => setOpen(open === run.id ? null : run.id)}
              >
                <span className="ai-run-when">{when(run.created_at)}</span>
                <span className="ai-run-name">
                  <Sparkles size={13} />
                  {run.conversation_id
                    ? `Conversation · ${group.length} questions`
                    : run.prompt_name === "Custom prompt"
                      ? run.instructions
                      : run.prompt_name}
                </span>
                <span className="ai-run-where">{run.where}</span>
                <span className={`ai-outcome ai-outcome-${run.outcome}`}>
                  {OUTCOMES[run.outcome] ?? run.outcome}
                </span>
              </button>
              {open === run.id &&
                [...group]
                  .reverse()
                  .map((turn) => (
                    <RunDetail
                      key={turn.id}
                      run={turn}
                      onRemove={() => remove.mutate(turn.id)}
                    />
                  ))}
            </li>
          );
        })}
      </ol>
      {Boolean(runs.data?.length) && (
        <div className="ai-editor-actions">
          <span />
          <Button
            size="small"
            variant="ghost"
            onClick={() => setClearing(true)}
          >
            Clear history
          </Button>
        </div>
      )}
      <ConfirmDialog
        open={clearing}
        pending={clear.isPending}
        title="Clear AI history?"
        description="Messages the AI changed keep their own edit history."
        keepLabel="Keep history"
        confirmLabel="Clear history"
        onClose={() => setClearing(false)}
        onConfirm={() => clear.mutate()}
      />
    </section>
  );
}

function RunDetail({ run, onRemove }: { run: AiRun; onRemove: () => void }) {
  const before = new Map(run.input.map((item) => [item.id, item.text]));
  return (
    <div className="ai-run-detail">
      <p className="ai-run-prompt">{run.instructions}</p>
      {run.error ? (
        <Notice tone="error">{run.error}</Notice>
      ) : Array.isArray(run.output) ? (
        <ul className="ai-changes">
          {(run.output as AiChange[]).map((change) => (
            <li key={change.id}>
              <span className="ai-before">{before.get(change.id)}</span>
              <ArrowRight size={12} />
              <span className="ai-after">{change.text}</span>
            </li>
          ))}
        </ul>
      ) : typeof run.output === "string" ? (
        <div className="ai-answer">
          <Markdown content={run.output} />
        </div>
      ) : run.place === "calendar" && run.output ? (
        <CalendarRunSummary proposal={run.output as CalendarProposal} />
      ) : null}
      <AiSources sources={run.usage?.sources ?? []} />
      <div className="ai-editor-actions">
        <small className="settings-hint">{run.model}</small>
        <Button size="small" variant="ghost" onClick={onRemove}>
          <Trash2 size={13} />
          Remove
        </Button>
      </div>
    </div>
  );
}

function CalendarRunSummary({ proposal }: { proposal: CalendarProposal }) {
  return (
    <div className="ai-answer">
      <p>{proposal.explanation}</p>
      <ul>
        {proposal.blocks.map((block, index) => (
          <li key={index}>
            {block.title} · {dayLabel(block.date)} ·{" "}
            {minuteLabel(block.start_minute)}–{minuteLabel(block.end_minute)}
          </li>
        ))}
      </ul>
    </div>
  );
}
