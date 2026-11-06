import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { request, ApiError } from "../../../lib/http";
import { useTracking } from "../../time-tracking/use-tracking";
import { addDays, zonedParts, wallTime } from "../../schedule/dates";
import { scheduleApi } from "../../schedule/api";
import { findGap, proposalConflicts } from "../calendar/plans";
import type { PreviewPlan } from "../calendar/types";
import { aiApi, runAi, type AiSource } from "../api";
import { nutritionApi } from "../../nutrition/api";
import { notesApi } from "../../notes/api";
import type {
  AssistantProposal,
  AttachedMessages,
  ChatSummary,
  ChatTurn,
} from "./types";
import type { CalendarScope } from "../calendar/types";
import type { PlanFields } from "../../schedule/types";

export interface AttachedPicture {
  key: string;
  id: string | null;
  preview: string;
}

const MAX_PICTURES = 4;
const hasChanges = (proposal: AssistantProposal | null | undefined) =>
  Boolean(
    proposal &&
      (proposal.habits?.length ?? 0) +
        (proposal.plans?.length ?? 0) +
        (proposal.meals?.length ?? 0) +
        (proposal.rewrites?.length ?? 0),
  );
const allSelected = (proposal: AssistantProposal) =>
  new Set([
    ...proposal.habits.map((_, i) => `habit-${i}`),
    ...proposal.plans.map((_, i) => `plan-${i}`),
    ...proposal.meals.map((_, i) => `meal-${i}`),
    ...(proposal.rewrites ?? []).map((_, i) => `rewrite-${i}`),
  ]);
const normalized = (proposal: AssistantProposal) => ({
  ...proposal,
  habits: Array.isArray(proposal.habits) ? proposal.habits : [],
  plans: Array.isArray(proposal.plans) ? proposal.plans : [],
  meals: Array.isArray(proposal.meals) ? proposal.meals : [],
  rewrites: Array.isArray(proposal.rewrites) ? proposal.rewrites : [],
});

/** Opens the assistant with messages attached, from anywhere in the app. */
export function askAboutMessages(detail: AttachedMessages) {
  window.dispatchEvent(new CustomEvent("noted:assistant-attach", { detail }));
}

export function useSharedAssistant() {
  const client = useQueryClient();
  const tracking = useTracking();
  const status = useQuery({ queryKey: ["ai-status"], queryFn: aiApi.status });
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [chatId, setChatId] = useState<string | null>(null);
  const [turnId, setTurnId] = useState<string | null>(null);
  const [pictures, setPictures] = useState<AttachedPicture[]>([]);
  const [loadingChat, setLoadingChat] = useState(false);
  const [attached, setAttached] = useState<AttachedMessages | null>(null);
  const [streaming, setStreaming] = useState<string | null>(null);
  // The text each message had when it was attached, to apply rewrites safely and undo them.
  const originals = useRef(new Map<string, string>());
  const [focusRequest, setFocusRequest] = useState(0);
  const restored = useRef(false);
  const chats = useQuery({
    queryKey: ["assistant-chats"],
    queryFn: () => request<ChatSummary[]>("/ai/assistant/chats"),
    enabled: open && Boolean(status.data?.connected),
  });
  const [proposal, setProposal] = useState<AssistantProposal | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);
  const [retryPending, setRetryPending] = useState(false);
  const [error, setError] = useState("");
  const [stage, setStage] = useState("");
  const [sources, setSources] = useState<AiSource[]>([]);
  const [scope, setScope] = useState<CalendarScope | null>(null);
  const abort = useRef<AbortController | null>(null);
  const attempt = useRef({ key: "", id: "" });
  const generation = useRef(0);
  const inFlight = useRef(false);
  const board = useQuery({
    queryKey: [
      "schedule",
      "assistant",
      scope?.start,
      scope?.end,
      scope?.timezone,
    ],
    queryFn: () =>
      scheduleApi.board(
        wallTime(scope!.start, 0, scope!.timezone),
        wallTime(addDays(scope!.end, 1), 0, scope!.timezone),
      ),
    enabled: open && Boolean(scope) && scope!.end >= scope!.start,
  });
  const previews: PreviewPlan[] = useMemo(
    () =>
      (proposal?.plans ?? []).map((change, index) => ({
        ...change.fields,
        id: `assistant-${index}`,
        selected: selected.has(`plan-${index}`),
        notifications_enabled: change.fields.notifications_enabled ?? true,
        notification_minutes: change.fields.notification_minutes ?? null,
      })),
    [proposal, selected],
  );
  const contextPlans = useMemo(() => {
    const edits = (proposal?.plans ?? []).filter(
      (change, index) => change.id && selected.has(`plan-${index}`),
    );
    return (board.data?.plans ?? []).filter(
      (plan) =>
        !edits.some(
          (change) =>
            change.id === plan.id &&
            (change.scope !== "occurrence" ||
              change.occurrence_date === plan.occurrence_date),
        ),
    );
  }, [board.data, proposal, selected]);
  const conflicts =
    scope && !applied
      ? proposalConflicts(
          previews.filter((plan) => plan.selected),
          contextPlans,
          scope,
          new Set(
            (tracking.activities.data ?? [])
              .filter((item) => !item.archived)
              .map((item) => item.id),
          ),
          Date.now(),
        )
      : new Map<string, string>();
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    const reveal = () => {
      const preferences = tracking.tracker.data?.preferences;
      if (preferences) {
        const today = zonedParts(Date.now(), preferences.timezone).date;
        setScope(
          (current) =>
            current ?? {
              start: today,
              end: addDays(today, 6),
              timezone: preferences.timezone,
              start_minute: preferences.start_minute,
              end_minute: preferences.end_minute,
            },
        );
      }
      setOpen(true);
    };
    const attach = (event: Event) => {
      const detail = (event as CustomEvent<AttachedMessages>).detail;
      for (const note of detail.notes)
        originals.current.set(note.id, note.content);
      setAttached(detail);
      reveal();
      setFocusRequest((value) => value + 1);
    };
    window.addEventListener("noted:assistant-open", reveal);
    window.addEventListener("noted:assistant-attach", attach);
    return () => {
      window.removeEventListener("noted:assistant-open", reveal);
      window.removeEventListener("noted:assistant-attach", attach);
    };
  }, [tracking.tracker.data?.preferences]);
  const preview = useMemo(() => {
    const shown = new Map<string, { text: string; done: boolean }>();
    if (!proposal || applied) return shown;
    (proposal.rewrites ?? []).forEach((change, index) => {
      if (selected.has(`rewrite-${index}`))
        shown.set(change.id, { text: change.text, done: true });
    });
    return shown;
  }, [proposal, applied, selected]);
  async function openChat(id: string) {
    cancel();
    setLoadingChat(true);
    setError("");
    try {
      const loaded = await request<(ChatTurn & { id: string })[]>(
        `/ai/assistant/chats/${id}`,
      );
      setChatId(id);
      setTurns(loaded);
      const last = loaded.at(-1);
      const pending =
        last?.role === "assistant" && !last.applied && hasChanges(last.proposal)
          ? (last.proposal as AssistantProposal)
          : null;
      setProposal(pending && normalized(pending));
      setSelected(pending ? allSelected(pending) : new Set());
      setTurnId(pending ? last!.id : null);
      setApplied(false);
      setSources(last?.role === "assistant" ? (last.sources ?? []) : []);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setLoadingChat(false);
    }
  }
  function newChat() {
    cancel();
    setChatId(null);
    setTurns([]);
    setProposal(null);
    setTurnId(null);
    setApplied(false);
    setSources([]);
    setError("");
    setAttached(null);
  }
  async function deleteChat(id: string) {
    try {
      await request<void>(`/ai/assistant/chats/${id}`, "DELETE");
      if (id === chatId) newChat();
      await client.invalidateQueries({ queryKey: ["assistant-chats"] });
    } catch (error) {
      toast.error((error as Error).message);
    }
  }
  // Opening the assistant picks up the most recent chat, so a reload or another device
  // continues where the owner left off.
  useEffect(() => {
    if (!open || restored.current || !chats.data) return;
    restored.current = true;
    if (chats.data[0] && !turns.length) void openChat(chats.data[0].id);
    // openChat is stable enough for a one-time restore.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, chats.data]);
  async function addPictures(files: Iterable<File>) {
    const chosen = Array.from(files)
      .filter((file) => file.type.startsWith("image/"))
      .slice(0, MAX_PICTURES - pictures.length);
    for (const file of chosen) {
      const key = `${file.name}-${Date.now()}-${Math.random()}`;
      const preview = URL.createObjectURL(file);
      setPictures((before) => [...before, { key, id: null, preview }]);
      try {
        const saved = await nutritionApi.uploadPhoto(file);
        setPictures((before) =>
          before.map((item) =>
            item.key === key ? { ...item, id: saved.id } : item,
          ),
        );
      } catch (error) {
        URL.revokeObjectURL(preview);
        setPictures((before) => before.filter((item) => item.key !== key));
        toast.error((error as Error).message);
      }
    }
  }
  function removePicture(key: string) {
    setPictures((before) => {
      const gone = before.find((item) => item.key === key);
      if (gone) URL.revokeObjectURL(gone.preview);
      return before.filter((item) => item.key !== key);
    });
  }
  async function ask(saved?: { id: string; name: string }) {
    const pictureIds = pictures.flatMap((item) => (item.id ? [item.id] : []));
    if (
      inFlight.current ||
      applying ||
      retryPending ||
      pictures.some((item) => item.id === null) ||
      (!saved && !prompt.trim() && !pictureIds.length)
    )
      return;
    if (!status.data?.connected) {
      setError("Connect your AI provider in Settings > AI first.");
      return;
    }
    const preferences = tracking.tracker.data?.preferences;
    if (!preferences) {
      setError("Wait for your calendar preferences to load.");
      return;
    }
    const today = zonedParts(Date.now(), preferences.timezone).date;
    const nextScope = scope ?? {
      start: today,
      end: addDays(today, 6),
      timezone: preferences.timezone,
      start_minute: preferences.start_minute,
      end_minute: preferences.end_minute,
    };
    const typed = saved ? "" : prompt.trim();
    const question =
      typed ||
      saved?.name ||
      (pictureIds.length > 1 ? "Here are some pictures." : "Here's a picture.");
    const context = attached && {
      channel_id: attached.channelId,
      message_ids: attached.notes.map((note) => note.id),
      thread_root_id: attached.threadRootId ?? null,
      prompt_id: saved?.id ?? null,
    };
    // The server keeps the chat, but only this device knows how the owner edited or
    // unticked the last proposal, so that turn is sent as they left it.
    const history = turns.slice(-18).map((turn) => ({
      role: turn.role,
      content:
        turn.role === "assistant"
          ? JSON.stringify(turn.proposal ?? { explanation: turn.content })
          : turn.content,
    }));
    if (proposal && !applied && history.at(-1)?.role === "assistant") {
      history[history.length - 1] = {
        role: "assistant",
        content: JSON.stringify({
          ...proposal,
          habits: proposal.habits.filter((_, i) => selected.has(`habit-${i}`)),
          plans: proposal.plans.filter((_, i) => selected.has(`plan-${i}`)),
          meals: proposal.meals.filter((_, i) => selected.has(`meal-${i}`)),
        }),
      };
    }
    const controller = new AbortController();
    abort.current = controller;
    const current = ++generation.current;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setStage("Thinking…");
    setSources([]);
    setProposal(null);
    setTurnId(null);
    setApplied(false);
    setStreaming(null);
    setTurns((items) => [
      ...items,
      {
        role: "user",
        content: question,
        photo_ids: pictureIds,
        attached: attached && {
          channel_id: attached.channelId,
          channel_name: attached.channelName,
          message_ids: attached.notes.map((note) => note.id),
          thread_root_id: attached.threadRootId ?? null,
          prompt_name: saved?.name ?? null,
        },
      },
    ]);
    if (!saved) setPrompt("");
    setPictures([]);
    setScope(nextScope);
    const remembered: string[] = [];
    try {
      await runAi(
        {
          ...nextScope,
          instructions: saved ? "" : question,
          history,
          proposals: [],
          chat_id: chatId,
          photo_ids: pictureIds,
          context,
        } as Parameters<typeof runAi>[0],
        (event) => {
          if (current !== generation.current) return;
          if (event.type === "chat") {
            setChatId(event.chat_id);
            void client.invalidateQueries({ queryKey: ["assistant-chats"] });
          }
          if (event.type === "turn") setTurnId(event.turn_id);
          if (event.type === "explanation") {
            setStreaming(event.text);
            setStage("");
          }
          if (event.type === "memory" && event.action === "remember")
            remembered.push(event.text);
          if (event.type === "search")
            setStage(event.action === "read" ? "Reading notes…" : "Searching…");
          if (event.type === "sources") setSources(event.sources);
          if (event.type === "error") throw new Error(event.message);
          if (event.type === "done") {
            const raw = event.output as unknown as AssistantProposal;
            if (!Array.isArray(raw.habits) || !Array.isArray(raw.plans))
              throw new Error(
                "The assistant returned an incomplete proposal. Try again.",
              );
            const result = normalized(raw);
            setStreaming(null);
            setProposal(hasChanges(result) ? result : null);
            setSources(event.sources ?? []);
            setSelected(allSelected(result));
            if (result.posted) {
              void client.invalidateQueries({ queryKey: ["thread"] });
              void client.invalidateQueries({ queryKey: ["notes"] });
            }
            if (result.reply_error) setError(result.reply_error);
            setTurns((items) => [
              ...items,
              {
                role: "assistant",
                content: result.explanation,
                proposal: result,
                sources: event.sources ?? [],
                remembered: [...remembered],
              },
            ]);
          }
        },
        controller.signal,
        "/ai/assistant",
      );
    } catch (error) {
      if (!controller.signal.aborted) setError((error as Error).message);
    } finally {
      if (current === generation.current) {
        setBusy(false);
        setStage("");
        setStreaming(null);
        inFlight.current = false;
      }
    }
  }
  /** Saves the ticked rewrites as ordinary edits, so each message keeps its old text in History. */
  async function applyRewrites(changes: { id: string; text: string }[]) {
    const done: { id: string; before?: string; after: string }[] = [];
    for (const change of changes) {
      const before = originals.current.get(change.id);
      if (before === change.text) continue;
      await notesApi.update(change.id, change.text, before);
      originals.current.set(change.id, change.text);
      done.push({ id: change.id, before, after: change.text });
    }
    if (!done.length) return 0;
    await Promise.all([
      client.invalidateQueries({ queryKey: ["notes"] }),
      client.invalidateQueries({ queryKey: ["thread"] }),
      client.invalidateQueries({ queryKey: ["search"] }),
    ]);
    const undoable = done.filter((item) => item.before !== undefined);
    toast.success(
      `Rewrote ${done.length} message${done.length === 1 ? "" : "s"}`,
      undoable.length
        ? {
            description: "The old text is in each message's History.",
            action: {
              label: "Undo",
              onClick: () =>
                void Promise.all(
                  undoable.map((item) =>
                    notesApi.update(item.id, item.before!, item.after),
                  ),
                )
                  .then(() => {
                    for (const item of undoable)
                      originals.current.set(item.id, item.before!);
                    return client.invalidateQueries({ queryKey: ["notes"] });
                  })
                  .catch((error: Error) => toast.error(error.message)),
            },
          }
        : undefined,
    );
    return done.length;
  }
  /** Pictures are drawn after the meals are saved, one at a time; a failure leaves the meal as it is. */
  async function makePictures(ids: string[]) {
    for (const id of ids) {
      try {
        await request(`/ai/nutrition/meals/${id}/picture`, "POST");
        await client.invalidateQueries({ queryKey: ["nutrition"] });
      } catch (error) {
        toast.error((error as Error).message);
        return;
      }
    }
  }
  function cancel() {
    abort.current?.abort();
    generation.current++;
    inFlight.current = false;
    setBusy(false);
    setStage("");
  }
  async function apply() {
    if (
      !proposal ||
      !scope ||
      applying ||
      !selected.size ||
      (conflicts.size && !retryPending)
    )
      return;
    const rewrites = (proposal.rewrites ?? []).filter((_, i) =>
      selected.has(`rewrite-${i}`),
    );
    const body = {
      ...scope,
      explanation: proposal.explanation,
      habits: proposal.habits.filter((_, i) => selected.has(`habit-${i}`)),
      plans: proposal.plans.filter((_, i) => selected.has(`plan-${i}`)),
      meals: proposal.meals.filter((_, i) => selected.has(`meal-${i}`)),
    };
    const records = body.habits.length + body.plans.length + body.meals.length;
    const key = JSON.stringify(body);
    if (attempt.current.key !== key)
      attempt.current = { key, id: crypto.randomUUID() };
    setApplying(true);
    setError("");
    try {
      if (rewrites.length) await applyRewrites(rewrites);
      const saved =
        records || turnId
          ? await request<{ pictures?: string[] }>(
              "/ai/assistant/apply",
              "POST",
              { ...body, request_id: attempt.current.id, turn_id: turnId },
            )
          : {};
      setApplied(true);
      setTurns((items) =>
        items.map((item, index) =>
          index === items.length - 1 && item.role === "assistant"
            ? { ...item, applied: true }
            : item,
        ),
      );
      setRetryPending(false);
      await Promise.all([
        client.invalidateQueries({ queryKey: ["habits"] }),
        client.invalidateQueries({ queryKey: ["schedule"] }),
        client.invalidateQueries({ queryKey: ["schedule-plan"] }),
        client.invalidateQueries({ queryKey: ["nutrition"] }),
      ]);
      if (records) toast.success("Changes applied");
      void makePictures(saved.pictures ?? []);
    } catch (error) {
      setError((error as Error).message);
      setRetryPending(!(error instanceof ApiError) || error.status >= 500);
    } finally {
      setApplying(false);
    }
  }
  return {
    open,
    setOpen,
    prompt,
    setPrompt,
    turns,
    chatId,
    chats: chats.data ?? [],
    loadingChat,
    openChat: (id: string) => void openChat(id),
    newChat,
    deleteChat: (id: string) => void deleteChat(id),
    attached,
    detach: () => setAttached(null),
    originalOf: (id: string) => originals.current.get(id),
    streaming,
    preview,
    focusRequest,
    putDraft: (text: string) => {
      if (!attached) return;
      window.dispatchEvent(
        new CustomEvent("noted:assistant-draft", {
          detail: {
            channelId: attached.channelId,
            threadRootId: attached.threadRootId ?? null,
            text,
          },
        }),
      );
      toast.success(
        attached.threadRootId
          ? "Put in the thread's reply box"
          : `Put in #${attached.channelName}'s message box`,
      );
    },
    pictures,
    addPictures: (files: Iterable<File>) => void addPictures(files),
    removePicture,
    maxPictures: MAX_PICTURES,
    proposal,
    selected,
    setSelected,
    busy,
    applying,
    applied,
    retryPending,
    error,
    stage,
    sources,
    scope,
    setScope: (next: CalendarScope) => {
      if (retryPending) return;
      cancel();
      setScope(next);
      setProposal(null);
      setApplied(false);
    },
    ask,
    cancel,
    apply,
    connected: status.data?.connected,
    conflicts,
    findGap: (index: number) => {
      if (
        !scope ||
        !previews[index] ||
        retryPending ||
        busy ||
        applying ||
        applied
      )
        return;
      const gap = findGap(
        previews[index],
        previews.filter((item) => item.selected),
        contextPlans,
        scope,
      );
      if (!gap) {
        setError("No free gap in the selected hours. Choose another day.");
        return;
      }
      setProposal(
        (current) =>
          current && {
            ...current,
            plans: current.plans.map((plan, i) =>
              i === index
                ? {
                    ...plan,
                    fields: {
                      ...plan.fields,
                      start_minute: gap.start_minute,
                      end_minute: gap.end_minute,
                    },
                  }
                : plan,
            ),
          },
      );
    },
    changePlan: (index: number, fields: Partial<PlanFields>) => {
      if (busy || applying || applied || retryPending) return;
      setProposal(
        (current) =>
          current && {
            ...current,
            plans: current.plans.map((plan, i) =>
              i === index
                ? { ...plan, fields: { ...plan.fields, ...fields } }
                : plan,
            ),
          },
      );
    },
  };
}
