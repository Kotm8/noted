import { useEffect, useMemo, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../../../components/ui/button";
import { Notice } from "../../../components/ui/notice";
import { notesApi } from "../../notes/api";
import type { Note } from "../../notes/types";
import { threadsApi } from "../../threads/api";
import type { Channel } from "../../workspaces/types";
import { aiApi, type AiKind, type AiPrompt } from "../api";
import { useAiRun } from "../use-ai-run";
import { AiSources, AiThinking } from "./ai-feedback";
import { KINDS } from "../kinds";
import { useAiPrompts, useAiStatus } from "../queries";

/** What the timeline shows on a message while a rewrite is previewed. */
export type AiPreview = Map<string, { text: string; done: boolean }>;

/**
 * Ask AI for selected messages (design A01): a small popover with a prompt box, the four
 * result kinds, and saved prompts. Rewrites preview on the messages themselves; nothing
 * changes until Apply.
 */
export function AskAi({
  channel,
  notes,
  selected,
  onPreview,
  onDraft,
  onDone,
  anchor,
  onClose,
}: {
  channel: Channel;
  notes: Note[];
  selected: ReadonlySet<string>;
  onPreview: (preview: AiPreview | null) => void;
  onDraft: (text: string) => void;
  onDone: () => void;
  anchor?: HTMLElement;
  onClose?: () => void;
}) {
  const status = useAiStatus();
  const prompts = useAiPrompts(Boolean(status.data?.connected));
  const client = useQueryClient();
  const [open, setOpen] = useState(Boolean(anchor));
  const [prompt, setPrompt] = useState("");
  const [kind, setKind] = useState<AiKind>(() =>
    notes
      .filter((note) => selected.has(note.id))
      .every((note) => !note.content.trim())
      ? "answer"
      : "rewrite",
  );
  const stream = useAiRun();
  const run = useMemo(
    () =>
      stream.result && {
        ...stream.result,
        done: ["done", "error"].includes(stream.result.stage),
      },
    [stream.result],
  );
  const [applying, setApplying] = useState(false);
  const chosen = notes.filter((note) => selected.has(note.id));
  const pictures = chosen
    .flatMap((note) => note.attachments)
    .filter((file) =>
      ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(
        file.content_type,
      ),
    );

  function refresh() {
    return Promise.all([
      client.invalidateQueries({ queryKey: ["notes", channel.id] }),
      client.invalidateQueries({ queryKey: ["thread"] }),
      client.invalidateQueries({ queryKey: ["search"] }),
    ]);
  }

  // Applying clears the selection, which removes this button before `run` resets.
  useEffect(
    () => () => {
      onPreview(null);
    },
    [onPreview],
  );
  useEffect(() => {
    if (!run || run.kind !== "rewrite") return onPreview(null);
    onPreview(
      new Map(
        run.changes.map((change) => [
          change.id,
          { text: change.text, done: run.done },
        ]),
      ),
    );
  }, [run, onPreview]);

  if (!status.data?.connected) return null;

  function start(input: {
    prompt?: AiPrompt;
    instructions?: string;
    kind: AiKind;
  }) {
    void stream.start(
      {
        place: "messages",
        channel_id: channel.id,
        message_ids: chosen.map((note) => note.id),
        kind: input.kind,
        ...(input.prompt
          ? { prompt_id: input.prompt.id }
          : { instructions: input.instructions }),
      },
      input.prompt?.name,
    );
  }

  function finish(outcome: string | null) {
    stream.cancel();
    if (run?.id && outcome)
      void aiApi.setOutcome(run.id, outcome).catch(() => undefined);
    setOpen(false);
    onClose?.();
  }

  async function apply() {
    if (!run) return;
    setApplying(true);
    try {
      if (run.kind === "rewrite") {
        const originals = new Map(
          chosen.map((note) => [note.id, note.content]),
        );
        const changed = run.changes.filter(
          (change) => originals.get(change.id) !== change.text,
        );
        for (const change of changed)
          await notesApi.update(
            change.id,
            change.text,
            originals.get(change.id),
          );
        await refresh();
        toast.success(
          `Rewrote ${changed.length} message${changed.length === 1 ? "" : "s"}`,
          {
            description: "The originals are in each message's edit history.",
            action: {
              label: "Undo",
              onClick: () =>
                void Promise.all(
                  changed.map((change) =>
                    notesApi.update(
                      change.id,
                      originals.get(change.id)!,
                      change.text,
                    ),
                  ),
                )
                  .then(refresh)
                  .catch((error: Error) => toast.error(error.message)),
            },
          },
        );
        finish("applied");
      } else if (run.kind === "reply") {
        await threadsApi.reply(
          chosen[0].thread_root_id ?? chosen[0].id,
          run.text,
        );
        await refresh();
        toast.success("Added as a thread reply");
        finish("reply");
      } else if (run.kind === "draft") {
        onDraft(run.text);
        finish("draft");
      } else {
        await notesApi.create(channel.id, run.text);
        await client.invalidateQueries({ queryKey: ["notes", channel.id] });
        toast.success(`Saved as a note in #${channel.name}`);
        finish("saved");
      }
      onDone();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setApplying(false);
    }
  }

  const listed = (prompts.data ?? []).filter((item) =>
    item.places.includes("messages"),
  );
  const applyLabel = run
    ? {
        rewrite: "Apply",
        reply: "Add reply",
        draft: "Use draft",
        answer: "Save as note",
      }[run.kind]
    : "";
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (next) setOpen(true);
        else finish(run?.done && !run.error ? "cancelled" : null);
      }}
    >
      {anchor ? (
        <Popover.Anchor virtualRef={{ current: anchor }} />
      ) : (
        <Popover.Trigger asChild>
          <button type="button" className="ask-ai-button">
            <Sparkles size={14} />
            Ask AI
          </button>
        </Popover.Trigger>
      )}
      <Popover.Portal>
        <Popover.Content
          className="ask-ai"
          side="bottom"
          align="end"
          sideOffset={8}
          collisionPadding={12}
          aria-label="Ask AI"
          onCloseAutoFocus={(event) => {
            if (anchor?.isConnected) {
              event.preventDefault();
              anchor.focus();
            }
          }}
          onInteractOutside={(event) => {
            // Messages stay readable and scrollable while a rewrite is previewed on them.
            if (run?.kind === "rewrite") event.preventDefault();
          }}
        >
          <header className="ask-ai-head">
            <Sparkles size={14} />
            <strong>{run ? run.name : "Ask AI"}</strong>
            <span>
              {chosen.length} message{chosen.length === 1 ? "" : "s"}
              {pictures.length > 0 &&
                ` · ${pictures.length} picture${pictures.length === 1 ? "" : "s"}`}
            </span>
          </header>
          {run ? (
            <>
              <AiThinking result={run} />
              {run.error ? (
                <Notice tone="error">{run.error}</Notice>
              ) : run.kind === "rewrite" ? (
                <p className="ask-ai-hint">
                  {run.done
                    ? run.changes.length
                      ? "Check the changes on the messages."
                      : "Nothing to change."
                    : run.stage === "writing"
                      ? "Writing on the messages…"
                      : null}
                </p>
              ) : (
                <div
                  className={`ask-ai-answer${run.done ? "" : " streaming"}`}
                  aria-live="polite"
                >
                  {run.text || (run.done ? "" : "…")}
                </div>
              )}
              <AiSources sources={run.sources} />
              <div className="ask-ai-actions">
                <Button
                  variant="ghost"
                  size="small"
                  onClick={() => stream.cancel()}
                >
                  <ArrowLeft size={13} />
                  Change prompt
                </Button>
                <span />
                <Button
                  variant="ghost"
                  size="small"
                  onClick={() =>
                    finish(run.done && !run.error ? "cancelled" : null)
                  }
                >
                  {run.kind === "answer" ? "Close" : "Cancel"}
                </Button>
                {!run.error && (
                  <Button
                    size="small"
                    disabled={
                      !run.done ||
                      applying ||
                      (run.kind === "rewrite" ? !run.changes.length : !run.text)
                    }
                    onClick={() => void apply()}
                  >
                    {!run.done
                      ? "Writing…"
                      : applying
                        ? "Applying…"
                        : applyLabel}
                  </Button>
                )}
              </div>
            </>
          ) : (
            <form
              className="ask-ai-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (prompt.trim()) start({ instructions: prompt.trim(), kind });
              }}
            >
              <label className="ask-ai-input">
                <Sparkles size={14} />
                <textarea
                  autoFocus
                  rows={2}
                  maxLength={4000}
                  aria-label="Prompt"
                  placeholder={`What should the AI do with ${chosen.length} message${chosen.length === 1 ? "" : "s"}?`}
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      if (prompt.trim())
                        start({ instructions: prompt.trim(), kind });
                    }
                  }}
                />
                <button
                  type="submit"
                  className="ask-ai-run"
                  aria-label="Ask"
                  disabled={!prompt.trim()}
                >
                  <ArrowRight size={14} />
                </button>
              </label>
              <div
                className="ask-ai-kinds"
                role="radiogroup"
                aria-label="What it returns"
              >
                {(Object.keys(KINDS) as AiKind[]).map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={kind === value}
                    title={KINDS[value].hint}
                    onClick={() => setKind(value)}
                  >
                    {KINDS[value].label}
                  </button>
                ))}
              </div>
              {pictures.length > 0 && (
                <p className="ask-ai-hint">
                  Attached pictures are included.
                  {pictures.some((file) => file.content_type === "image/gif") &&
                    " GIFs use the first frame."}
                </p>
              )}
              {listed.length > 0 && (
                <div className="ask-ai-saved">
                  <span className="field-caption">Saved prompts</span>
                  {listed.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => start({ prompt: item, kind: item.kind })}
                    >
                      <span>{item.name}</span>
                      <small>{KINDS[item.kind].label}</small>
                    </button>
                  ))}
                </div>
              )}
            </form>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
