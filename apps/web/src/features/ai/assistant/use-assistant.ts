import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { request, ApiError } from "../../../lib/http";
import { useTracking } from "../../time-tracking/use-tracking";
import { addDays, zonedParts, wallTime } from "../../schedule/dates";
import { scheduleApi } from "../../schedule/api";
import { findGap, proposalConflicts } from "../calendar/plans";
import type { PreviewPlan } from "../calendar/types";
import { aiApi, runAi, type AiTurn, type AiSource } from "../api";
import type { AssistantProposal } from "./types";
import type { CalendarScope } from "../calendar/types";
import type { PlanFields } from "../../schedule/types";

export function useSharedAssistant() {
  const client = useQueryClient();
  const tracking = useTracking();
  const status = useQuery({ queryKey: ["ai-status"], queryFn: aiApi.status });
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [turns, setTurns] = useState<AiTurn[]>([]);
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
    window.addEventListener("noted:assistant-open", reveal);
    return () => window.removeEventListener("noted:assistant-open", reveal);
  }, [tracking.tracker.data?.preferences]);
  async function ask() {
    if (inFlight.current || applying || retryPending || !prompt.trim()) return;
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
    const question = prompt.trim();
    const history = turns.slice(-18);
    if (proposal && !applied && history.at(-1)?.role === "assistant") {
      history[history.length - 1] = {
        role: "assistant",
        content: JSON.stringify({
          ...proposal,
          habits: proposal.habits.filter((_, i) => selected.has(`habit-${i}`)),
          plans: proposal.plans.filter((_, i) => selected.has(`plan-${i}`)),
          meals: (proposal.meals ?? []).filter((_, i) =>
            selected.has(`meal-${i}`),
          ),
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
    setApplied(false);
    setTurns((items) => [...items, { role: "user", content: question }]);
    setPrompt("");
    setScope(nextScope);
    try {
      await runAi(
        {
          ...nextScope,
          instructions: question,
          history,
          proposals: [],
        },
        (event) => {
          if (current !== generation.current) return;
          if (event.type === "search")
            setStage(event.action === "read" ? "Reading notes…" : "Searching…");
          if (event.type === "sources") setSources(event.sources);
          if (event.type === "error") throw new Error(event.message);
          if (event.type === "done") {
            const result = event.output as unknown as AssistantProposal;
            result.meals = Array.isArray(result.meals) ? result.meals : [];
            if (!Array.isArray(result.habits) || !Array.isArray(result.plans))
              throw new Error(
                "The assistant returned an incomplete proposal. Try again.",
              );
            setProposal(result);
            setSources(event.sources ?? []);
            setSelected(
              new Set([
                ...result.habits.map((_, i) => `habit-${i}`),
                ...result.plans.map((_, i) => `plan-${i}`),
                ...result.meals.map((_, i) => `meal-${i}`),
              ]),
            );
            setTurns((items) => [
              ...items,
              { role: "assistant", content: JSON.stringify(result) },
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
        inFlight.current = false;
      }
    }
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
    const body = {
      ...scope,
      explanation: proposal.explanation,
      habits: proposal.habits.filter((_, i) => selected.has(`habit-${i}`)),
      plans: proposal.plans.filter((_, i) => selected.has(`plan-${i}`)),
      meals: proposal.meals.filter((_, i) => selected.has(`meal-${i}`)),
    };
    const key = JSON.stringify(body);
    if (attempt.current.key !== key)
      attempt.current = { key, id: crypto.randomUUID() };
    setApplying(true);
    setError("");
    try {
      const saved = await request<{ pictures?: string[] }>(
        "/ai/assistant/apply",
        "POST",
        { ...body, request_id: attempt.current.id },
      );
      setApplied(true);
      setRetryPending(false);
      await Promise.all([
        client.invalidateQueries({ queryKey: ["habits"] }),
        client.invalidateQueries({ queryKey: ["schedule"] }),
        client.invalidateQueries({ queryKey: ["schedule-plan"] }),
        client.invalidateQueries({ queryKey: ["nutrition"] }),
      ]);
      toast.success("Changes applied");
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
