import { useAssistant } from "../ai/assistant/context";
import { liveInterval } from "../../lib/live";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  useQueries,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Flag,
  Info,
  Menu,
  MousePointer2,
  Plus,
  Repeat2,
  Settings,
  Square,
  Timer,
  Sparkles,
} from "lucide-react";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { toast } from "sonner";
import { Button } from "../../components/ui/button";
import { DatePicker } from "../../components/ui/date-picker";
import { Notice } from "../../components/ui/notice";
import { useTracking } from "../time-tracking/use-tracking";
import type { TimeSession } from "../time-tracking/types";
import { BLOCK_WEEKS, blockQuery, blockStart, blocksAround } from "./blocks";
import {
  addDays,
  dayLabel,
  dateRangeLabel,
  defaultPlanTimes,
  minuteLabel,
  weekDays,
  zonedParts,
} from "./dates";
import { CalendarGrid } from "./components/calendar-grid";
import { PlanDialog } from "./components/plan-dialog";
import { PlanCard, type PlanAnchor } from "./components/plan-card";
import { SessionEditor } from "./components/session-editor";
import type {
  PlanFields,
  PlanOccurrence,
  ReminderFlag,
  ScheduleBoard as BoardData,
} from "./types";
import { useScheduleGestures } from "./use-schedule-gestures";
import { useScheduleHistory } from "./use-schedule-history";
import { SaveDayTemplate } from "../templates/components/save-day-template";
import { DayTemplatePicker } from "../templates/components/day-template-picker";
import type { DragValues } from "./use-schedule-gestures";
import { useAiStatus } from "../ai/queries";
import { useCalendarPlanner } from "../ai/calendar/use-calendar-planner";
import { CalendarPlanner } from "../ai/calendar/calendar-planner";
import { ProposalEditor } from "../ai/calendar/proposal-editor";
import { previewOccurrence } from "../ai/calendar/plans";
import type { PreviewPlan } from "../ai/calendar/types";
import { useScheduleWrites } from "./use-schedule-writes";
import { applyLocalWrite, localOccurrence } from "./local-plans";
import { ScheduleSyncStatus } from "./components/sync-status";
import { isDayOff } from "../time-tracking/work-schedule";

/** Blocks load separately, so items spanning a block boundary arrive twice. */
function mergeBoards(boards: BoardData[]): BoardData {
  const unique = <T,>(items: T[], key: (item: T) => string) => [
    ...new Map(items.map((item) => [key(item), item])).values(),
  ];
  return {
    plans: unique(
      boards.flatMap((board) => board.plans),
      (plan) => `${plan.id}~${plan.occurrence_date}`,
    ),
    sessions: unique(
      boards.flatMap((board) => board.sessions),
      (session) => session.id,
    ),
    reminders: unique(
      boards.flatMap((board) => board.reminders),
      (flag) => flag.message_id,
    ),
  };
}

function combineBoards(boards: UseQueryResult<BoardData>[]) {
  const loaded = boards.flatMap((board) => (board.data ? [board.data] : []));
  return {
    data: loaded.length ? mergeBoards(loaded) : undefined,
    error: boards.find((board) => board.error)?.error,
    missing: boards.map((board) => !board.data),
    fetching: boards.some((board) => board.isFetching),
  };
}

const weekday = (day: string) =>
  (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7;
/**
 * Where a week's Monday row sits below the sticky time axis and week header.
 * Measured on the row because stuck sticky headers report their stuck position.
 */
function weekOffset(box: HTMLElement, row: HTMLElement) {
  const axis = box.querySelector<HTMLElement>(".schedule-axis-row");
  const header = row.previousElementSibling as HTMLElement | null;
  return (
    row.offsetTop - (axis?.offsetHeight ?? 0) - (header?.offsetHeight ?? 0)
  );
}

export function ScheduleBoard({
  onNavigation,
  onReminder,
  onSettings,
}: {
  onNavigation: () => void;
  onReminder: (flag: ReminderFlag) => void;
  onSettings: () => void;
}) {
  const { tracker, activities, action } = useTracking();
  const preferences = tracker.data?.preferences ?? {
    start_minute: 480,
    end_minute: 1320,
    timezone: "UTC",
  };
  const [date, setDate] = useState(
    () => zonedParts(Date.now(), preferences.timezone).date,
  );
  const [mode, setMode] = useState<"week" | "day">("week");
  const [editing, setEditing] = useState<{
    plan: PlanFields | PlanOccurrence;
    /** The block the quick card points at; without it the full form opens. */
    anchor?: PlanAnchor;
    anchorX?: number;
    deleting?: boolean;
  } | null>(null);
  const [session, setSession] = useState<TimeSession | null>(null);
  const [draft, setDraft] = useState<PlanFields | null>(null);
  const [now, setNow] = useState(Date.now());
  const [loaded, setLoaded] = useState(() => blocksAround(date));
  const [visibleWeek, setVisibleWeek] = useState(() => weekDays(date)[0]);
  const [jumps, setJumps] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const topEdge = useRef<HTMLDivElement>(null);
  const bottomEdge = useRef<HTMLDivElement>(null);
  const scrollTarget = useRef<string | null>(weekDays(date)[0]);
  const prepended = useRef<{ height: number; top: number } | null>(null);
  const client = useQueryClient();
  const history = useScheduleHistory();
  const writes = useScheduleWrites(history);
  const ai = useAiStatus();
  const [proposalEditor, setProposalEditor] = useState<{
    plan: PreviewPlan;
    anchor: DOMRect;
  } | null>(null);
  const blockStarts = useMemo(
    () =>
      mode === "week"
        ? Array.from({ length: loaded.weeks / BLOCK_WEEKS }, (_, index) =>
            addDays(loaded.first, index * BLOCK_WEEKS * 7),
          )
        : [blockStart(date)],
    [mode, loaded.first, loaded.weeks, date],
  );
  const boards = useQueries({
    combine: combineBoards,
    queries: blockStarts.map((first) => ({
      ...blockQuery(first, preferences.timezone),
      enabled: Boolean(tracker.data),
      refetchInterval: () =>
        document.body.classList.contains("schedule-dragging")
          ? false
          : liveInterval(15000),
    })),
  });
  const timezone = preferences.timezone;
  const edges =
    mode === "week"
      ? [
          addDays(loaded.first, -BLOCK_WEEKS * 7),
          addDays(loaded.first, loaded.weeks * 7),
        ].join()
      : "";
  // The blocks just past each edge are fetched ahead, so scrolling into them never waits.
  useEffect(() => {
    if (!tracker.data || !edges) return;
    for (const first of edges.split(","))
      void client.prefetchQuery(blockQuery(first, timezone));
  }, [client, edges, timezone, tracker.data]);
  const days = useMemo(
    () =>
      mode === "week"
        ? Array.from({ length: loaded.weeks * 7 }, (_, index) =>
            addDays(loaded.first, index),
          )
        : [date],
    [mode, loaded.first, loaded.weeks, date],
  );
  const loading = useMemo(
    () =>
      new Set(
        mode === "week"
          ? blockStarts.flatMap((first, index) =>
              boards.missing[index]
                ? Array.from({ length: BLOCK_WEEKS * 7 }, (_, day) =>
                    addDays(first, day),
                  )
                : [],
            )
          : [],
      ),
    [mode, blockStarts, boards.missing],
  );
  const data = boards.data;
  const localData = useMemo(
    () =>
      data &&
      writes.pending.reduce(
        (board, state) =>
          applyLocalWrite(
            board,
            state.write,
            days[0],
            days[days.length - 1],
            preferences.timezone,
          ),
        data,
      ),
    [data, writes.pending, days, preferences.timezone],
  );
  const boardError = boards.error;

  /** Jumps to a day, reloading around it when it is outside the loaded weeks. */
  function showDay(day: string) {
    setDate(day);
    const week = weekDays(day)[0];
    const last = addDays(loaded.first, loaded.weeks * 7);
    if (week < loaded.first || week >= last) setLoaded(blocksAround(day));
    scrollTarget.current = week;
    setJumps((count) => count + 1);
  }
  const sharedAssistant = useAssistant();
  const sharedProposals = useMemo(
    () =>
      sharedAssistant.applied
        ? []
        : (sharedAssistant.proposal?.plans ?? []).map((change, index) => ({
            ...change.fields,
            id: `assistant-${index}`,
            notifications_enabled: change.fields.notifications_enabled ?? true,
            notification_minutes: change.fields.notification_minutes ?? null,
            selected: sharedAssistant.selected.has(`plan-${index}`),
          })),
    [
      sharedAssistant.applied,
      sharedAssistant.proposal,
      sharedAssistant.selected,
    ],
  );
  useEffect(() => {
    const edit = (event: Event) => {
      const { index, anchor } = (
        event as CustomEvent<{ index: number; anchor: DOMRect }>
      ).detail;
      const plan = sharedProposals[index];
      if (plan && !sharedAssistant.busy && !sharedAssistant.applying)
        setProposalEditor({ plan, anchor });
    };
    window.addEventListener("noted:assistant-edit-plan", edit);
    return () => window.removeEventListener("noted:assistant-edit-plan", edit);
  }, [sharedProposals, sharedAssistant.busy, sharedAssistant.applying]);
  const sharedEditingChanges = useMemo(() => sharedAssistant.applied ? [] : (sharedAssistant.proposal?.plans ?? []).filter((change,index)=>change.id && sharedAssistant.selected.has(`plan-${index}`)),[sharedAssistant.applied,sharedAssistant.proposal,sharedAssistant.selected]);
  const planner = useCalendarPlanner(
    date,
    preferences,
    activities.data ?? [],
    history,
    showDay,
  );
  const previewPlans = useMemo(
    () =>
      [...planner.proposals, ...sharedProposals].flatMap((plan) => {
        const occurrence = previewOccurrence(
          plan,
          plan.id.startsWith("assistant-")
            ? (sharedAssistant.scope?.timezone ?? preferences.timezone)
            : planner.scope.timezone,
        );
        return occurrence ? [occurrence] : [];
      }),
    [
      planner.proposals,
      planner.scope.timezone,
      sharedProposals,
      sharedAssistant.scope?.timezone,
      preferences.timezone,
    ],
  );
  const gridData = useMemo(
    () =>
      localData && {
        ...localData,
        plans: [
          ...localData.plans.filter((plan) => !sharedEditingChanges.some((change) => change.id === plan.id && (change.scope !== "occurrence" || change.occurrence_date === plan.occurrence_date))),
          ...previewPlans,
        ],
      },
    [localData, previewPlans, sharedEditingChanges],
  );
  const onGridPlan = useCallback(
    (plan: PlanOccurrence, block: DOMRect) => {
      if (plan.id.startsWith("assistant-")) {
        const proposed = sharedProposals.find((item) => item.id === plan.id);
        if (proposed && !sharedAssistant.busy && !sharedAssistant.applying)
          setProposalEditor({ plan: proposed, anchor: block });
        return;
      }
      const proposal = planner.proposals.find((item) => item.id === plan.id);
      if (proposal) {
        if (!planner.busy) setProposalEditor({ plan: proposal, anchor: block });
        return;
      }
      setEditing({
        plan,
        anchor: {
          left: block.left,
          right: block.right,
          top: block.top,
          bottom: block.bottom,
        },
      });
    },
    [planner.proposals, planner.busy, sharedAssistant, sharedProposals],
  );
  const onGridDay = useCallback((day: string) => {
    setDate(day);
    setMode("day");
  }, []);
  const startActivity = action.mutate;
  const onGridStart = useCallback(
    (id: string) => startActivity({ action: "start", activityId: id }),
    [startActivity],
  );
  const ready = Boolean(data);
  useLayoutEffect(() => {
    const box = scroller.current;
    if (!box) return;
    if (prepended.current) {
      // Browsers keep the visible rows still when content is added above,
      // except when the list was scrolled to the very top.
      if (prepended.current.top === 0 && box.scrollTop === 0)
        box.scrollTop = box.scrollHeight - prepended.current.height;
      prepended.current = null;
    }
    const target = scrollTarget.current;
    const row = target
      ? box.querySelector<HTMLElement>(`[data-week="${target}"]`)
      : null;
    if (!row) return;
    box.scrollTop = weekOffset(box, row);
    setVisibleWeek(target!);
    scrollTarget.current = null;
  }, [jumps, loaded, mode, ready]);
  useEffect(() => {
    const box = scroller.current;
    if (mode !== "week" || !box || !topEdge.current || !bottomEdge.current)
      return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (scrollTarget.current) return;
        const entry = entries.find((item) => item.isIntersecting);
        if (!entry) return;
        if (entry.target === topEdge.current) {
          prepended.current = { height: box.scrollHeight, top: box.scrollTop };
          setLoaded((current) => ({
            first: addDays(current.first, -BLOCK_WEEKS * 7),
            weeks: current.weeks + BLOCK_WEEKS,
          }));
        } else
          setLoaded((current) => ({
            ...current,
            weeks: current.weeks + BLOCK_WEEKS,
          }));
      },
      { root: box, rootMargin: "1200px 0px" },
    );
    observer.observe(topEdge.current);
    observer.observe(bottomEdge.current);
    return () => observer.disconnect();
  }, [mode, loaded, ready]);
  function trackVisibleWeek() {
    const box = scroller.current;
    if (!box || mode !== "week") return;
    let week = visibleWeek;
    for (const row of box.querySelectorAll<HTMLElement>("[data-week]"))
      if (weekOffset(box, row) <= box.scrollTop + 40) week = row.dataset.week!;
    if (week !== visibleWeek) setVisibleWeek(week);
  }
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!document.body.classList.contains("schedule-dragging"))
        setNow(Date.now());
    }, 30000);
    return () => clearInterval(timer);
  }, []);
  /** Where a new plan's block will appear, so the card can point at it before it exists. */
  function trackAnchor(values: DragValues, activityId: string) {
    const tracks = root.current?.querySelectorAll<HTMLElement>(
      `[data-draw][data-date="${values.date}"]`,
    );
    const track =
      [...(tracks ?? [])].find(
        (item) =>
          !item.dataset.activity || item.dataset.activity === activityId,
      ) ?? tracks?.[0];
    if (!track) return undefined;
    const box = track.getBoundingClientRect();
    const span = preferences.end_minute - preferences.start_minute;
    const x = (minute: number) =>
      box.left + ((minute - preferences.start_minute) / span) * box.width;
    return {
      left: x(values.start_minute),
      right: x(values.end_minute),
      top: box.top,
      bottom: box.top + 62,
    };
  }
  function create(values: DragValues) {
    const activityId =
      values.activity_id ?? activities.data?.find((item) => !item.archived)?.id;
    if (!activityId) {
      toast("Add an activity in Settings first.");
      onSettings();
      return;
    }
    setEditing({
      anchorX: values.anchorX,
      anchor: trackAnchor(values, activityId),
      plan: {
        activity_id: activityId,
        title: "",
        date: values.date,
        start_minute: values.start_minute,
        end_minute: values.end_minute,
        timezone: preferences.timezone,
        frequency: "none",
        weekdays: [weekday(values.date)],
        repeat_until: null,
      },
    });
  }
  function change(id: string, values: DragValues) {
    if (id.startsWith("assistant-")) {
      sharedAssistant.changePlan(Number(id.split("~")[0].slice(10)), values);
      return;
    }
    const proposal = planner.proposals.find(
      (item) => `${item.id}~${item.date}` === id,
    );
    if (proposal) {
      if (!planner.busy) planner.change(proposal.id, values);
      return;
    }
    const original = localData?.plans.find(
      (item) => `${item.id}~${item.occurrence_date}` === id,
    );
    if (!original) return;
    try {
      writes.save({ ...original, ...values }, original, undefined, "the move");
    } catch (error) {
      toast.error((error as Error).message);
    }
  }
  function copy(id: string, values: DragValues) {
    if (id.startsWith("proposal-") || id.startsWith("assistant-")) {
      change(id, values);
      return;
    }
    const original = localData?.plans.find(
      (item) => `${item.id}~${item.occurrence_date}` === id,
    );
    if (!original) return;
    try {
      writes.save(
        {
          ...original,
          ...values,
          frequency: "none",
          weekdays: [],
          repeat_until: null,
        },
        undefined,
        "series",
        "the copy",
      );
    } catch (error) {
      toast.error((error as Error).message);
    }
  }
  useScheduleGestures(root, {
    preferences,
    pending: false,
    create,
    change,
    copy,
  });
  return (
    <>
      <div className="schedule-page">
        <header className="channel-header schedule-header">
          <div className="channel-heading">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={onNavigation}
            >
              <Menu size={20} />
            </button>
            <CalendarDays size={19} />
            <h1>Schedule</h1>
            <span>One calendar. All your activities.</span>
          </div>
          <button
            className="icon-button"
            aria-label="Time tracking settings"
            onClick={onSettings}
          >
            <Settings size={18} />
          </button>
        </header>
        <div
          className={`schedule-content${planner.open && ai.data?.connected ? " calendar-ai-open" : ""}`}
          ref={root}
          aria-busy={boards.fetching}
        >
          <div className="schedule-toolbar">
            <div className="schedule-date-navigation">
              <button
                className="icon-button"
                aria-label={mode === "week" ? "Previous week" : "Previous day"}
                onClick={() =>
                  mode === "week"
                    ? showDay(addDays(visibleWeek, -7))
                    : setDate(addDays(date, -1))
                }
              >
                <ChevronLeft size={16} />
              </button>
              <button
                className="icon-button"
                aria-label={mode === "week" ? "Next week" : "Next day"}
                onClick={() =>
                  mode === "week"
                    ? showDay(addDays(visibleWeek, 7))
                    : setDate(addDays(date, 1))
                }
              >
                <ChevronRight size={16} />
              </button>
              <DatePicker
                label="Choose displayed date"
                displayLabel={
                  mode === "week"
                    ? dateRangeLabel(visibleWeek, addDays(visibleWeek, 6))
                    : dayLabel(date, {
                        weekday: "long",
                        day: "numeric",
                        month: "long",
                      })
                }
                value={date}
                onChange={showDay}
              />
              <Button
                variant="ghost"
                size="small"
                onClick={() =>
                  showDay(zonedParts(Date.now(), preferences.timezone).date)
                }
              >
                Today
              </Button>
            </div>
            <div className="schedule-toolbar-actions">
              {ai.data?.connected && (
                <Button
                  variant="ghost"
                  size="small"
                  onClick={() =>
                    window.dispatchEvent(new Event("noted:assistant-open"))
                  }
                  aria-expanded={planner.open}
                >
                  <Sparkles size={15} />
                  {planner.proposals.length ? "Review plans" : "Ask AI"}
                </Button>
              )}
              <SaveDayTemplate date={date} timezone={preferences.timezone} />
              {mode === "day" && (
                <DayTemplatePicker
                  date={date}
                  timezone={preferences.timezone}
                />
              )}
              <div className="schedule-view-switch" aria-label="Calendar view">
                <button
                  aria-pressed={mode === "week"}
                  onClick={() => {
                    setMode("week");
                    showDay(date);
                  }}
                >
                  Week
                </button>
                <button
                  aria-pressed={mode === "day"}
                  onClick={() => setMode("day")}
                >
                  Day
                </button>
              </div>
              <Button
                size="small"
                onClick={() =>
                  create({
                    date,
                    ...defaultPlanTimes(preferences.timezone),
                  })
                }
              >
                <Plus size={15} />
                Add plan
              </Button>
            </div>
          </div>
          <div className="schedule-caption">
            <div className="schedule-legend">
              <span>
                <Square size={12} />
                One-off plan
              </span>
              <span>
                <Repeat2 size={13} />
                Recurring
              </span>
              <span>
                <Timer size={13} />
                Actual
              </span>
              <span>
                <Flag size={12} />
                Reminder
              </span>
            </div>
            <div className="schedule-caption-actions">
              {Boolean(data?.reminders.length) && (
                <Dropdown.Root modal={false}>
                  <Dropdown.Trigger asChild>
                    <button className="schedule-reminders-trigger">
                      <Flag size={13} />
                      {data!.reminders.length} upcoming
                    </button>
                  </Dropdown.Trigger>
                  <Dropdown.Portal>
                    <Dropdown.Content
                      className="dropdown-content schedule-reminders-menu"
                      align="end"
                      sideOffset={6}
                      collisionPadding={12}
                    >
                      {data!.reminders.map((flag) => (
                        <Dropdown.Item
                          className="dropdown-item"
                          key={flag.message_id}
                          onSelect={() => onReminder(flag)}
                        >
                          <Flag size={14} />
                          <span>
                            <strong>
                              {dayLabel(
                                zonedParts(flag.due_at, preferences.timezone)
                                  .date,
                              )}{" "}
                              ·{" "}
                              {minuteLabel(
                                zonedParts(flag.due_at, preferences.timezone)
                                  .minute,
                              )}
                            </strong>
                            <span>
                              {flag.workspace_name} / #{flag.channel_name}
                            </span>
                            <small>{flag.content}</small>
                          </span>
                        </Dropdown.Item>
                      ))}
                    </Dropdown.Content>
                  </Dropdown.Portal>
                </Dropdown.Root>
              )}
              <button className="schedule-hours-button" onClick={onSettings}>
                {minuteLabel(preferences.start_minute)}–
                {minuteLabel(preferences.end_minute)}
                <Settings size={12} />
              </button>
            </div>
          </div>
          {mode === "day" && (
            <div className="schedule-day-strip">
              {weekDays(date).map((day) => (
                <button
                  key={day}
                  aria-pressed={day === date}
                  className={
                    isDayOff(day, preferences.work_schedule)
                      ? "is-day-off"
                      : undefined
                  }
                  onClick={() => setDate(day)}
                >
                  <span>{dayLabel(day, { weekday: "short" })}</span>
                  <strong>{Number(day.slice(8))}</strong>
                  <small className="schedule-day-kind">
                    {isDayOff(day, preferences.work_schedule)
                      ? "Day off"
                      : "Workday"}
                  </small>
                </button>
              ))}
            </div>
          )}
          {(boardError || tracker.error || activities.error) && (
            <Notice tone="error">
              {(boardError ?? tracker.error ?? activities.error)?.message}
              <Button
                variant="ghost"
                size="small"
                onClick={() => {
                  void client.invalidateQueries({ queryKey: ["schedule"] });
                  void tracker.refetch();
                  void activities.refetch();
                }}
              >
                Retry
              </Button>
            </Notice>
          )}
          {!data && !boardError && (
            <p className="schedule-loading">Loading your schedule…</p>
          )}
          {data && (
            <div
              className="schedule-timeline-scroll"
              ref={scroller}
              onScroll={trackVisibleWeek}
            >
              {mode === "week" && <div ref={topEdge} aria-hidden="true" />}
              <CalendarGrid
                days={days}
                loading={loading}
                selected={date}
                mode={mode}
                data={gridData!}
                proposals={[...planner.proposals, ...sharedProposals]}
                proposalConflicts={planner.conflicts}
                preferences={preferences}
                activities={activities.data ?? []}
                now={now}
                onPlan={onGridPlan}
                onSession={setSession}
                onReminder={onReminder}
                onDay={onGridDay}
                draft={
                  editing?.anchor && !("id" in editing.plan) ? draft : null
                }
                onStart={onGridStart}
              />
              {mode === "week" && <div ref={bottomEdge} aria-hidden="true" />}
            </div>
          )}
          <footer className="schedule-footer">
            <span>
              <MousePointer2 size={13} />
              Click or right-click to plan · drag to draw or move · Ctrl-drag to
              copy · edges to resize · 15-minute steps
            </span>
            <span>
              <Info size={13} />
              Times use {preferences.timezone}
            </span>
          </footer>
          <ScheduleSyncStatus
            writes={writes}
            onReview={(state) => {
              const write = state.write;
              const current = data?.plans.find(
                (plan) =>
                  plan.id === write.plan.id &&
                  (write.scope === "series" ||
                    plan.occurrence_date === write.original?.occurrence_date),
              );
              setEditing({
                plan: {
                  ...localOccurrence(write.plan, write.plan.date)!,
                  ...write.original,
                  ...write.plan,
                  revision: current?.revision ?? write.plan.revision,
                },
              });
              writes.forget(state.id);
            }}
          />
        </div>
        {ai.data?.connected && (
          <CalendarPlanner
            planner={planner}
            activities={activities.data ?? []}
            onEdit={(plan, anchor) => setProposalEditor({ plan, anchor })}
            onDay={showDay}
          />
        )}
      </div>
      {proposalEditor && (
        <ProposalEditor
          key={proposalEditor.plan.id}
          plan={proposalEditor.plan}
          anchor={proposalEditor.anchor}
          activities={activities.data ?? []}
          onSave={(plan) => {
            if (plan.id.startsWith("assistant-")) {
              const { id, selected, ...fields } = plan;
              void selected;
              sharedAssistant.changePlan(Number(id.slice(10)), fields);
            } else planner.change(plan.id, plan);
          }}
          onClose={() => setProposalEditor(null)}
        />
      )}
      {editing?.anchor && (
        <PlanCard
          key={`${editing.anchor.left}:${editing.anchor.top}`}
          initial={editing.plan}
          anchor={editing.anchor}
          activities={activities.data ?? []}
          writes={writes}
          onMore={(fields, deleting) =>
            setEditing({
              plan: { ...editing.plan, ...fields },
              anchorX: editing.anchor!.right,
              deleting,
            })
          }
          onDraft={setDraft}
          onClose={() => {
            setEditing(null);
            setDraft(null);
          }}
        />
      )}
      {editing && !editing.anchor && (
        <PlanDialog
          initial={editing.plan}
          deleting={editing.deleting}
          anchorX={editing.anchorX}
          activities={activities.data ?? []}
          hours={preferences}
          writes={writes}
          onClose={() => setEditing(null)}
        />
      )}
      {session && (
        <SessionEditor
          session={session}
          activities={activities.data ?? []}
          timezone={preferences.timezone}
          onClose={() => setSession(null)}
        />
      )}
    </>
  );
}
