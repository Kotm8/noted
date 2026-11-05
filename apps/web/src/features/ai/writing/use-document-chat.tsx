import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUp, Clock3, Copy, Plus, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../../../components/ui/button";
import { Markdown } from "../../notes/components/markdown";
import { aiApi, type AiRun, type AiRunInput, type AiTurn } from "../api";
import { useAiPreferences, useAiStatus } from "../queries";
import { newAiResult, useAiRun, type AiResult } from "../use-ai-run";
import { AiSources, AiThinking } from "../components/ai-feedback";
import { AiWritingError } from "./ai-writing-error";
import { insertParagraph, paragraphEnd } from "./selection";

interface Turn {
  question: string;
  instructions?: string;
  answer: AiResult;
}
interface Insertion {
  source: string;
  at: number;
  answer: string;
  runId: string | null;
}
interface ChatOptions {
  channelId: string;
  title: string;
  content: string;
  onChange: (content: string) => void;
  getCursor: () => number | null;
  flush: () => Promise<void>;
  checkSource: () => Promise<{ content: string }>;
}

function fromRun(run: AiRun): Turn {
  return {
    question: run.instructions,
    answer: {
      ...newAiResult("answer", run.prompt_name),
      id: run.id,
      text: typeof run.output === "string" ? run.output : "",
      model: run.model,
      stage: run.error ? "error" : "done",
      error: run.error,
      sources: run.usage?.sources ?? [],
      thoughtSeconds: run.usage?.thought_seconds ?? null,
      searched: run.usage?.searched ?? false,
    },
  };
}

export function useDocumentChat(options: ChatOptions) {
  const latest = useRef(options);
  latest.current = options;
  const stream = useAiRun();
  const preferences = useAiPreferences();
  const status = useAiStatus();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [past, setPast] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const turnsRef = useRef(turns);
  turnsRef.current = turns;
  const conversation = useRef<string | null>(null);
  const [question, setQuestion] = useState<string | null>(null);
  const [followup, setFollowup] = useState("");
  const [selected, setSelected] = useState(false);
  const [insertion, setInsertion] = useState<Insertion | null>(null);
  const [inserting, setInserting] = useState(false);
  const [insertError, setInsertError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const generation = useRef(0);
  const input = useRef<HTMLTextAreaElement>(null);
  const keepHistory = preferences.query.data?.keep_history ?? true;
  const histories = useQuery({
    queryKey: ["ai-conversations", options.channelId],
    queryFn: () => aiApi.conversations(options.channelId),
    enabled: open && past && keepHistory,
  });

  async function send(
    request: AiRunInput,
    name = "Custom prompt",
    fresh = false,
    isSelection = false,
  ) {
    const ticket = ++generation.current;
    if (fresh || !conversation.current) {
      conversation.current = crypto.randomUUID();
      setTurns([]);
      turnsRef.current = [];
    }
    setOpen(true);
    setPast(false);
    setInsertion(null);
    setHistoryError(null);
    setSelected(isSelection);
    const previous = turnsRef.current;
    const history: AiTurn[] = previous
      .filter((turn) => turn.answer.stage === "done")
      .flatMap((turn) => [
        { role: "user" as const, content: turn.instructions ?? turn.question },
        { role: "assistant" as const, content: turn.answer.text },
      ])
      .slice(-20);
    const title = request.prompt_id ? name : request.instructions || name;
    setQuestion(title);
    const answer = await stream.start(
      { ...request, conversation_id: conversation.current, history },
      name,
    );
    if (ticket !== generation.current || !answer) return;
    if (answer.stage === "error" && request.instructions)
      setFollowup((current) => current || request.instructions!);
    setTurns([
      ...previous,
      { question: title, instructions: request.instructions, answer },
    ]);
    setQuestion(null);
    stream.cancel();
    void client.invalidateQueries({
      queryKey: ["ai-conversations", options.channelId],
    });
    void client.invalidateQueries({ queryKey: ["ai-runs"] });
  }

  function ask(request: AiRunInput, name: string, isSelection: boolean) {
    void send(request, name, true, isSelection);
  }
  function focus() {
    if (!open && !conversation.current) return false;
    setOpen(true);
    requestAnimationFrame(() => input.current?.focus());
    return true;
  }
  function hide() {
    generation.current++;
    if (question && stream.result)
      setTurns([
        ...turnsRef.current,
        {
          question,
          answer: {
            ...stream.result,
            stage: "error",
            error: "Answer stopped. Ask again to continue.",
          },
        },
      ]);
    stream.cancel();
    setQuestion(null);
    setOpen(false);
    setInsertion(null);
  }
  function newConversation() {
    generation.current++;
    stream.cancel();
    conversation.current = null;
    setTurns([]);
    setQuestion(null);
    setInsertion(null);
    setFollowup("");
    setPast(false);
    input.current?.focus();
  }
  function follow() {
    if (!followup.trim() || stream.busy || !navigator.onLine) return;
    const instructions = followup.trim();
    setFollowup("");
    void send({
      place: "documents",
      channel_id: options.channelId,
      kind: "answer",
      instructions,
      text: latest.current.content || `Title: ${latest.current.title}`,
      where: options.title.slice(0, 120),
    });
  }
  async function load(id: string) {
    const ticket = ++generation.current;
    stream.cancel();
    setQuestion(null);
    setHistoryError(null);
    try {
      const runs = await aiApi.conversation(id);
      if (ticket !== generation.current) return;
      conversation.current = id;
      setTurns(runs.map(fromRun));
      setPast(false);
      setInsertion(null);
    } catch (error) {
      if (ticket === generation.current)
        setHistoryError((error as Error).message);
    }
  }
  function previewInsert(answer: AiResult) {
    const source = latest.current.content;
    const at = paragraphEnd(
      source,
      latest.current.getCursor() ?? source.length,
    );
    setInsertion({ source, at, answer: answer.text, runId: answer.id });
    setInsertError(null);
    if (matchMedia("(max-width: 760px)").matches) setOpen(false);
  }
  async function insert() {
    if (!insertion || inserting) return;
    setInserting(true);
    try {
      if (latest.current.content !== insertion.source)
        throw new Error(
          "This document changed. Choose Insert again to use the latest version.",
        );
      await latest.current.flush();
      const saved = await latest.current.checkSource();
      if (
        saved.content !== insertion.source ||
        latest.current.content !== insertion.source
      )
        throw new Error(
          "This document changed on another device. Choose Insert again.",
        );
      const after = insertParagraph(
        insertion.source,
        insertion.at,
        insertion.answer,
      );
      const before = insertion.source;
      latest.current.onChange(after);
      setInsertion(null);
      if (insertion.runId)
        void aiApi
          .setOutcome(insertion.runId, "applied")
          .catch(() => undefined);
      toast.success("Inserted into document", {
        action: {
          label: "Undo",
          onClick: () => {
            if (latest.current.content !== after) {
              toast.error(
                "The document has changed. Undo is no longer available.",
              );
              return;
            }
            latest.current.onChange(before);
          },
        },
      });
    } catch (error) {
      setInsertError((error as Error).message);
    } finally {
      setInserting(false);
    }
  }

  const visibleTurns =
    question && stream.result
      ? [...turns, { question, answer: stream.result }]
      : turns;
  const panel = open && status.data?.connected && (
    <aside
      className="ai-document-chat"
      aria-label={`Ask about ${options.title}`}
    >
      <header>
        <Sparkles size={15} />
        <strong>Ask about {options.title}</strong>
        <button
          className="icon-button"
          aria-label="Past conversations"
          title={keepHistory ? "Past conversations" : "History is off"}
          onClick={() => setPast(!past)}
        >
          <Clock3 size={15} />
        </button>
        <button
          className="icon-button"
          aria-label="New conversation"
          onClick={newConversation}
        >
          <Plus size={16} />
        </button>
        <button
          className="icon-button"
          aria-label="Close AI chat"
          onClick={hide}
        >
          <X size={16} />
        </button>
      </header>
      <div className="ai-chat-turns" aria-live="polite">
        {past ? (
          <div className="ai-conversation-list">
            <h3>Past conversations</h3>
            {!keepHistory ? (
              <p className="settings-hint">
                History is off. This conversation stays here until you leave the
                document.
              </p>
            ) : (
              <>
                {histories.isPending && (
                  <p className="settings-hint">Opening history…</p>
                )}
                {(histories.error || historyError) && (
                  <AiWritingError
                    message={historyError ?? histories.error!.message}
                  />
                )}
                {!histories.isPending && !histories.data?.length && (
                  <p className="settings-hint">No saved conversations yet.</p>
                )}
                {histories.data?.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    onClick={() => void load(item.id)}
                  >
                    <span>{item.question}</span>
                    <small>
                      {item.turns} questions ·{" "}
                      {new Date(item.updated_at).toLocaleDateString()}
                    </small>
                  </button>
                ))}
              </>
            )}
          </div>
        ) : (
          <>
            {!visibleTurns.length && (
              <p className="settings-hint">
                Ask a question about your document.
              </p>
            )}
            {visibleTurns.map((turn, index) => (
              <section className="ai-chat-turn" key={index}>
                <p className="ai-chat-question">{turn.question}</p>
                <AiThinking result={turn.answer} />
                {turn.answer.error ? (
                  <AiWritingError
                    message={turn.answer.error}
                    code={turn.answer.code}
                  />
                ) : (
                  <div
                    className={
                      turn.answer.stage === "writing" ? "streaming" : undefined
                    }
                  >
                    <Markdown content={turn.answer.text} />
                  </div>
                )}
                <AiSources sources={turn.answer.sources} />
                {turn.answer.stage === "done" && (
                  <div className="ai-answer-actions">
                    <Button
                      size="small"
                      variant="ghost"
                      disabled={stream.busy}
                      onClick={() => previewInsert(turn.answer)}
                    >
                      <Plus size={13} />
                      Insert
                    </Button>
                    <Button
                      size="small"
                      variant="ghost"
                      onClick={() =>
                        void navigator.clipboard
                          .writeText(turn.answer.text)
                          .then(() => toast.success("Copied"))
                          .catch(() => toast.error("Could not copy"))
                      }
                    >
                      <Copy size={13} />
                      Copy
                    </Button>
                  </div>
                )}
              </section>
            ))}
          </>
        )}
      </div>
      <footer>
        <form
          className="ai-chat-input"
          onSubmit={(event) => {
            event.preventDefault();
            follow();
          }}
        >
          <textarea
            ref={input}
            rows={2}
            aria-label="Follow-up question"
            placeholder="Ask a follow-up…"
            value={followup}
            maxLength={4000}
            onChange={(event) => setFollowup(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                follow();
              }
            }}
          />
          <button
            className="ask-ai-run"
            type="submit"
            aria-label="Send question"
            disabled={stream.busy || !followup.trim() || !navigator.onLine}
          >
            <ArrowUp size={16} />
          </button>
        </form>
        <div className="ai-chat-meta">
          <span>{selected ? "Selected text" : "Whole document"}</span>
          {preferences.query.data?.web_search && <span>Web on</span>}
          <span>{preferences.query.data?.model ?? ""}</span>
        </div>
      </footer>
    </aside>
  );

  const insertionPreview = insertion && (
    <div className="ai-insertion-document">
      <Markdown content={insertion.source.slice(0, insertion.at)} />
      <section className="ai-insert-preview" aria-label="AI insertion preview">
        <small>Inserts here, where your cursor was</small>
        <Markdown content={insertion.answer} />
        {insertError && <AiWritingError message={insertError} />}
        <div className="ai-answer-actions">
          <Button
            size="small"
            variant="ghost"
            onClick={() => setInsertion(null)}
          >
            Cancel
          </Button>
          <Button
            size="small"
            disabled={inserting}
            onClick={() => void insert()}
          >
            Insert
          </Button>
        </div>
      </section>
      <Markdown content={insertion.source.slice(insertion.at)} />
    </div>
  );
  return {
    open: open && Boolean(status.data?.connected),
    panel,
    ask,
    focus,
    insertionPreview,
  };
}
