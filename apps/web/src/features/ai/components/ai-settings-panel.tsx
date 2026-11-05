import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../../../components/ui/button";
import { ConfirmDialog } from "../../../components/ui/confirm-dialog";
import { Notice } from "../../../components/ui/notice";
import {
  aiApi,
  type AiPreferences,
  type AiStatus,
  type AiThinking,
} from "../api";
import { useAiModels, useAiPreferences, useAiStatus } from "../queries";

const THINKING: { value: AiThinking; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Highest" },
];

const when = (value: string | null | undefined) =>
  value
    ? new Date(value).toLocaleString([], {
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : "";

/** Settings › AI: the ChatGPT connection first, then how prompts run. */
export function AiSettingsPanel() {
  const status = useAiStatus();
  const connected = status.data?.connected ?? false;
  return (
    <section className="settings-panel ai-settings">
      <h2>AI</h2>
      <p>
        Rewrite, ask about your notes, and plan your calendar with your own
        ChatGPT plan.
      </p>
      {status.isError && <Notice tone="error">{status.error.message}</Notice>}
      {status.data && (connected ? <Connected /> : <ConnectCard />)}
    </section>
  );
}

function ConnectCard({ onDone }: { onDone?: () => void }) {
  const client = useQueryClient();
  const [address, setAddress] = useState("");
  const [started, setStarted] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [auth, setAuth] = useState("");
  const connected = (status: AiStatus) => {
    client.setQueryData(["ai-status"], status);
    void client.invalidateQueries({ queryKey: ["ai-models"] });
    toast.success(`Connected${status.plan ? ` · ChatGPT ${status.plan}` : ""}`);
    onDone?.();
  };
  // Fetched up front, so the sign-in opens from a plain link that popup blockers allow.
  const start = useQuery({
    queryKey: ["ai-sign-in"],
    queryFn: aiApi.startSignIn,
    staleTime: 10 * 60000,
    refetchOnWindowFocus: false,
  });
  const finish = useMutation({
    mutationFn: () => aiApi.finishSignIn(address.trim()),
    onSuccess: connected,
  });
  const paste = useMutation({
    mutationFn: () => aiApi.connect(auth.trim()),
    onSuccess: connected,
  });
  const error = start.error ?? finish.error ?? paste.error;
  return (
    <div className="ai-connect">
      <span className="ai-connect-mark">
        <Sparkles size={18} />
      </span>
      <h3>Connect ChatGPT to use AI in Noted</h3>
      <p>
        Nothing else to pay for: requests count against your plan's Codex usage.
        Until it's connected, AI doesn't appear anywhere else.
      </p>
      <ul>
        <li>
          <Check size={13} />
          Requests start when you press Ask. AI can use selected text and
          pictures, then search your messages, journals and documents when
          needed.
        </li>
        <li>
          <Check size={13} />
          Nothing changes until you press Apply.
        </li>
        <li>
          <Check size={13} />
          The sign-in is kept on your server, readable only by it.
        </li>
      </ul>
      <ol className="ai-connect-steps">
        <li>
          <a
            className="ui-button button-default button-primary ai-sign-in"
            href={start.data?.url}
            target="_blank"
            rel="noreferrer"
            aria-disabled={!start.data}
            onClick={() => setStarted(true)}
          >
            <Sparkles size={15} />
            {started ? "Open the sign-in again" : "Sign in with ChatGPT"}
          </a>
        </li>
        <li>
          After signing in, your browser opens a page on{" "}
          <code>localhost:1455</code> that doesn't load. That's expected: copy
          its whole address.
        </li>
        <li>
          <form
            className="ai-finish"
            onSubmit={(event) => {
              event.preventDefault();
              if (address.trim()) finish.mutate();
            }}
          >
            <input
              aria-label="Address of the page that didn't load"
              placeholder="http://localhost:1455/auth/callback?code=…"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              disabled={!started}
            />
            <Button
              type="submit"
              variant="secondary"
              disabled={!started || !address.trim() || finish.isPending}
            >
              {finish.isPending ? "Connecting…" : "Connect"}
            </Button>
          </form>
        </li>
      </ol>
      <small>
        This is Noted's own sign-in, so it doesn't sign out the Codex app on
        your computer.
      </small>
      {error && <Notice tone="error">{error.message}</Notice>}
      <button
        type="button"
        className="ai-paste-toggle"
        onClick={() => setPasting(!pasting)}
      >
        {pasting ? "Hide" : "Or paste auth.json from codex login"}
      </button>
      {pasting && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (auth.trim()) paste.mutate();
          }}
        >
          <label>
            Paste auth.json from <code>codex login</code>
            <textarea
              className="ai-auth-input"
              rows={4}
              spellCheck={false}
              autoComplete="off"
              value={auth}
              onChange={(event) => setAuth(event.target.value)}
              placeholder='{"tokens": { … }}'
            />
          </label>
          <small>
            Only paste a login you don't use anywhere else: whichever side
            refreshes first signs the other out.
          </small>
          <Button
            type="submit"
            variant="secondary"
            disabled={!auth.trim() || paste.isPending}
          >
            {paste.isPending ? "Connecting…" : "Connect with auth.json"}
          </Button>
        </form>
      )}
      <p className="ai-fine-print">
        Uses OpenAI's Codex sign-in through Pydantic AI. Your use is under your
        agreement with OpenAI; this isn't an official OpenAI integration.
      </p>
    </div>
  );
}

function Connected() {
  const client = useQueryClient();
  const status = useAiStatus().data!;
  const { query, save } = useAiPreferences();
  const models = useAiModels(true);
  const [reconnecting, setReconnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [calendarNote, setCalendarNote] = useState<string | null>(null);
  const disconnect = useMutation({
    mutationFn: aiApi.disconnect,
    onSuccess: () => {
      client.setQueryData(["ai-status"], { connected: false });
      setDisconnecting(false);
      toast.success("ChatGPT disconnected");
    },
  });
  const preferences = query.data;
  const change = (values: Partial<AiPreferences>) =>
    preferences && save.mutate({ ...preferences, ...values });
  const usage = status.usage;
  return (
    <>
      <div className="ai-connection">
        <span className="ai-status-dot" aria-hidden="true" />
        <div>
          <strong>
            Connected{status.plan ? ` · ChatGPT ${status.plan}` : ""}
          </strong>
          <small>Account …{status.account}</small>
        </div>
        <Button
          size="small"
          variant="secondary"
          onClick={() => setReconnecting(!reconnecting)}
        >
          Reconnect
        </Button>
        <Button
          size="small"
          variant="ghost"
          onClick={() => setDisconnecting(true)}
        >
          Disconnect
        </Button>
      </div>
      {usage &&
        (usage.five_hours_percent != null || usage.week_percent != null) && (
          <p className="settings-hint">
            Codex usage: {usage.five_hours_percent ?? "?"}% of the 5-hour limit
            (resets {when(usage.five_hours_resets_at)}),{" "}
            {usage.week_percent ?? "?"}% of the weekly limit (resets{" "}
            {when(usage.week_resets_at)}).
          </p>
        )}
      {reconnecting && <ConnectCard onDone={() => setReconnecting(false)} />}
      {preferences && (
        <div className="ai-preferences">
          <label>
            Model
            <input
              list="ai-models"
              value={preferences.model}
              maxLength={80}
              onChange={(event) =>
                client.setQueryData(["ai-preferences"], {
                  ...preferences,
                  model: event.target.value,
                })
              }
              onBlur={(event) =>
                event.target.value.trim() &&
                change({ model: event.target.value.trim() })
              }
            />
            <datalist id="ai-models">
              <option value="gpt-6.1-sol" />
              {models.data?.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))}
            </datalist>
            <small>
              Default gpt-6.1-sol. Pick one your plan lists, or type a model
              name. Saved prompts can choose their own.
            </small>
          </label>
          <div className="ai-field">
            <span className="field-caption">Thinking</span>
            <div
              className="ai-segmented"
              role="radiogroup"
              aria-label="Thinking"
            >
              {THINKING.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={preferences.thinking === option.value}
                  onClick={() => change({ thinking: option.value })}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <small>
              Low is fastest. Higher is slower and better for harder questions.
            </small>
          </div>
          <label>
            Standing note
            <textarea
              rows={3}
              maxLength={2000}
              value={note ?? preferences.standing_note}
              placeholder="I write in English and Russian. Keep my tone casual."
              onChange={(event) => setNote(event.target.value)}
              onBlur={() => {
                if (note !== null && note !== preferences.standing_note)
                  change({ standing_note: note });
                setNote(null);
              }}
            />
            <small>
              Added to every prompt, like a note the AI always reads.
            </small>
          </label>
          <Switch
            label="Web search"
            hint="Lets writing prompts search the web and list their sources. Searching your own Noted messages and journals is available separately, including in the calendar. Calendar planning does not search the web."
            checked={preferences.web_search}
            onChange={(web_search) => change({ web_search })}
          />
          <label>
            Calendar preferences
            <textarea
              rows={4}
              maxLength={2000}
              value={calendarNote ?? preferences.calendar_note ?? ""}
              placeholder="Deep work before lunch. Leave 15 minutes between activities. Finish by 18:00."
              onChange={(event) => setCalendarNote(event.target.value)}
              onBlur={() => {
                if (
                  calendarNote !== null &&
                  calendarNote !== preferences.calendar_note
                )
                  change({ calendar_note: calendarNote });
                setCalendarNote(null);
              }}
            />
            <small>
              Used only when planning your calendar, alongside your standing
              note. The planner uses your existing activities and does not
              search the web.
            </small>
          </label>
          <Switch
            label="Keep a history of AI runs"
            hint="What was asked, what came back, and whether you applied it."
            checked={preferences.keep_history}
            onChange={(keep_history) => change({ keep_history })}
          />
        </div>
      )}
      <ConfirmDialog
        open={disconnecting}
        pending={disconnect.isPending}
        title="Disconnect ChatGPT?"
        description="AI disappears from Noted until you connect again. Saved prompts and history stay."
        keepLabel="Stay connected"
        confirmLabel="Disconnect"
        onClose={() => setDisconnecting(false)}
        onConfirm={() => disconnect.mutate()}
      />
    </>
  );
}

export function Switch({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="ai-switch">
      <span>
        <strong>{label}</strong>
        {hint && <small>{hint}</small>}
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}
