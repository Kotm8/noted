import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError } from "../../../lib/http";
import { scheduleApi } from "../../schedule/api";
import { addDays, wallTime } from "../../schedule/dates";
import type { ScheduleHistory } from "../../schedule/use-schedule-history";
import type { Activity, TrackingPreferences } from "../../time-tracking/types";
import { useAiRun } from "../use-ai-run";
import { aiApi, type AiTurn } from "../api";
import { calendarAiApi } from "./api";
import { findGap, proposalConflicts } from "./plans";
import type { CalendarBlock, CalendarScope, PreviewPlan } from "./types";

const blockFields = (plan: PreviewPlan): CalendarBlock => ({
  activity_id: plan.activity_id,
  title: plan.title,
  date: plan.date,
  start_minute: plan.start_minute,
  end_minute: plan.end_minute,
  notifications_enabled: plan.notifications_enabled,
  notification_minutes: plan.notification_minutes,
});

export function useCalendarPlanner(
  date: string,
  preferences: TrackingPreferences,
  activities: Activity[],
  history: ScheduleHistory,
  showDay: (date: string) => void,
) {
  const run = useAiRun();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<CalendarScope>({
    start: date,
    end: date,
    timezone: preferences.timezone,
    start_minute: preferences.start_minute,
    end_minute: preferences.end_minute,
  });
  const [proposals, setProposals] = useState<PreviewPlan[]>([]);
  const [turns, setTurns] = useState<AiTurn[]>([]);
  const [prompt, setPrompt] = useState("");
  const [lastPrompt, setLastPrompt] = useState("");
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryPending, setRetryPending] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const attempt = useRef({ key: "", id: "" });
  const generation = useRef(0);
  const sourceRun = useRef<string | null>(null);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  const validScope =
    scope.end >= scope.start &&
    (Date.parse(scope.end) - Date.parse(scope.start)) / 86400000 <= 30 &&
    scope.end_minute > scope.start_minute;
  const board = useQuery({
    queryKey: [
      "schedule",
      "ai-context",
      scope.start,
      scope.end,
      scope.timezone,
    ],
    queryFn: () =>
      scheduleApi.board(
        wallTime(scope.start, 0, scope.timezone),
        wallTime(addDays(scope.end, 1), 0, scope.timezone),
      ),
    enabled: validScope && (open || proposals.length > 0),
    staleTime: 0,
  });
  const selected = proposals.filter((item) => item.selected);
  const timeBucket = Math.floor(Date.now() / 30000);
  const conflicts = useMemo(
    () =>
      proposalConflicts(
        proposals,
        board.data?.plans ?? [],
        scope,
        new Set(
          activities.filter((item) => !item.archived).map((item) => item.id),
        ),
        timeBucket * 30000,
      ),
    [proposals, board.data, scope, activities, timeBucket],
  );
  function changeScope(next: CalendarScope) {
    generation.current += 1;
    run.cancel();
    setScope(next);
    setProposals([]);
    setTurns([]);
    setError(null);
    setLastPrompt("");
    setRetryPending(false);
  }
  function reveal() {
    if (!proposals.length && !run.result)
      changeScope({
        start: date,
        end: date,
        timezone: preferences.timezone,
        start_minute: preferences.start_minute,
        end_minute: preferences.end_minute,
      });
    setOpen(true);
  }
  async function ask(instructions = prompt.trim()) {
    if (!instructions || run.busy || applying || !online || !validScope) return;
    setError(null);
    setLastPrompt(instructions);
    const token = ++generation.current;
    const result = await run.start(
      {
        ...scope,
        instructions,
        history: turns.slice(-18),
        proposals: selected.map(blockFields),
      },
      "Calendar planner",
      "/ai/calendar/runs",
    );
    if (
      token !== generation.current ||
      result?.stage !== "done" ||
      !result.proposal
    )
      return;
    const proposal = result.proposal;
    sourceRun.current = result.id;
    setProposals(
      proposal.blocks.map((item) => ({
        ...item,
        id: `proposal-${crypto.randomUUID()}`,
        selected: true,
      })),
    );
    setTurns((current) => [
      ...current.slice(-16),
      { role: "user", content: instructions } as AiTurn,
      { role: "assistant", content: JSON.stringify(proposal) } as AiTurn,
    ]);
    setPrompt("");
    if (proposal.blocks[0]) showDay(proposal.blocks[0].date);
  }
  function change(id: string, values: Partial<PreviewPlan>) {
    setProposals((current) =>
      current.map((item) => (item.id === id ? { ...item, ...values } : item)),
    );
    setError(null);
    setRetryPending(false);
  }
  function fit(id: string) {
    const plan = proposals.find((item) => item.id === id);
    const gap =
      plan && findGap(plan, proposals, board.data?.plans ?? [], scope);
    if (gap) {
      change(id, gap);
      showDay(gap.date);
    } else
      toast(
        "There is no free gap that fits on this day. Try another date or a shorter duration.",
      );
  }
  async function apply() {
    if (applying || run.busy || !selected.length || !online) return;
    setApplying(true);
    setError(null);
    try {
      const blocks = selected.map(blockFields);
      const key = JSON.stringify({ scope, blocks });
      if (!(retryPending && attempt.current.key === key)) {
        const fresh = await board.refetch();
        if (!fresh.data || fresh.error)
          throw fresh.error ?? new Error("Could not refresh your calendar.");
        const checked = proposalConflicts(
          proposals,
          fresh.data.plans,
          scope,
          new Set(
            activities.filter((item) => !item.archived).map((item) => item.id),
          ),
        );
        if (selected.some((item) => checked.has(item.id)))
          throw new Error(
            "Review the highlighted suggestions before adding them.",
          );
      }
      if (attempt.current.key !== key)
        attempt.current = { key, id: crypto.randomUUID() };
      let application = await calendarAiApi.apply(
        scope,
        blocks,
        attempt.current.id,
      );
      history.recordBatch({
        label: "adding AI plans",
        undo: async () => {
          application = await calendarAiApi.update(application, false);
        },
        redo: async () => {
          application = await calendarAiApi.update(application, true);
        },
      });
      if (run.result?.stage === "done") run.applied();
      else if (sourceRun.current)
        void aiApi
          .setOutcome(sourceRun.current, "applied")
          .catch(() => undefined);
      setProposals([]);
      setTurns([]);
      attempt.current = { key: "", id: "" };
      setRetryPending(false);
      void client.invalidateQueries({ queryKey: ["schedule"] });
      void client.invalidateQueries({ queryKey: ["home-activity"] });
      toast.success(
        `${application.plans.length} plans added`,
        history.undoToast(),
      );
    } catch (failure) {
      if (failure instanceof ApiError && failure.status < 500) {
        attempt.current = { key: "", id: "" };
        setRetryPending(false);
      } else setRetryPending(Boolean(attempt.current.id));
      setError((failure as Error).message);
      void board.refetch();
    } finally {
      setApplying(false);
    }
  }
  function discard() {
    generation.current += 1;
    run.cancel();
    setProposals([]);
    setTurns([]);
    setError(null);
    setPrompt("");
    setLastPrompt("");
    setRetryPending(false);
    setOpen(false);
    attempt.current = { key: "", id: "" };
  }
  return {
    open,
    setOpen,
    reveal,
    scope,
    changeScope,
    validScope,
    proposals,
    selected,
    conflicts,
    prompt,
    setPrompt,
    lastPrompt,
    ask,
    run,
    change,
    fit,
    apply,
    discard,
    applying,
    online,
    retryPending,
    error: error ?? run.result?.error ?? board.error?.message ?? null,
    boardReady: Boolean(board.data) && !board.isError,
    busy: run.busy || applying,
  };
}

export type CalendarPlannerState = ReturnType<typeof useCalendarPlanner>;
