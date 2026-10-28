import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
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
} from "lucide-react";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { toast } from "sonner";
import { Button } from "../../components/ui/button";
import { DatePicker } from "../../components/ui/date-picker";
import { Notice } from "../../components/ui/notice";
import { useTracking } from "../time-tracking/use-tracking";
import type { TimeSession } from "../time-tracking/types";
import { scheduleApi } from "./api";
import {
  addDays,
  dayLabel,
  dateRangeLabel,
  defaultPlanTimes,
  minuteLabel,
  wallTime,
  weekDays,
  zonedParts,
} from "./dates";
import { CalendarGrid } from "./components/calendar-grid";
import { PlanDialog } from "./components/plan-dialog";
import { SessionEditor } from "./components/session-editor";
import type {
  PlanFields,
  PlanOccurrence,
  ReminderFlag,
  ScheduleBoard as BoardData,
} from "./types";
import { useScheduleGestures } from "./use-schedule-gestures";
import type { DragValues } from "./use-schedule-gestures";

const INITIAL_WEEKS = 4;

/** Weeks load separately, so items spanning a week boundary arrive twice. */
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

const loadedAround = (day: string) => ({
  first: addDays(weekDays(day)[0], -7),
  weeks: INITIAL_WEEKS,
});

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
    anchorX?: number;
  } | null>(null);
  const [session, setSession] = useState<TimeSession | null>(null);
  const [pending, setPending] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [loaded, setLoaded] = useState(() => loadedAround(date));
  const [visibleWeek, setVisibleWeek] = useState(() => weekDays(date)[0]);
  const [jumps, setJumps] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const topEdge = useRef<HTMLDivElement>(null);
  const bottomEdge = useRef<HTMLDivElement>(null);
  const scrollTarget = useRef<string | null>(weekDays(date)[0]);
  const prepended = useRef<{ height: number; top: number } | null>(null);
  const client = useQueryClient();
  const weekStarts = Array.from({ length: loaded.weeks }, (_, index) =>
    addDays(loaded.first, index * 7),
  );
  const ranges =
    mode === "week"
      ? weekStarts.map((week) => [week, addDays(week, 7)])
      : [[date, addDays(date, 1)]];
  const boards = useQueries({
    queries: ranges.map(([first, next]) => {
      const start = wallTime(first, 0, preferences.timezone);
      const end = wallTime(next, 0, preferences.timezone);
      return {
        queryKey: ["schedule", start, end],
        queryFn: () => scheduleApi.board(start, end),
        enabled: Boolean(tracker.data),
        refetchInterval: () =>
          document.body.classList.contains("schedule-dragging") || pending
            ? false
            : 15000,
      };
    }),
  });
  const days =
    mode === "week"
      ? Array.from({ length: loaded.weeks * 7 }, (_, index) =>
          addDays(loaded.first, index),
        )
      : [date];
  const loading = new Set(
    mode === "week"
      ? weekStarts.flatMap((week, index) =>
          boards[index]?.data ? [] : weekDays(week),
        )
      : [],
  );
  const loadedBoards = boards.flatMap((board) =>
    board.data ? [board.data] : [],
  );
  const data = loadedBoards.length ? mergeBoards(loadedBoards) : undefined;
  const boardError = boards.find((board) => board.error)?.error;

  /** Jumps to a day, reloading around it when it is outside the loaded weeks. */
  function showDay(day: string) {
    setDate(day);
    const week = weekDays(day)[0];
    const last = addDays(loaded.first, loaded.weeks * 7);
    if (week < loaded.first || week >= last) setLoaded(loadedAround(day));
    scrollTarget.current = week;
    setJumps((count) => count + 1);
  }
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
            first: addDays(current.first, -7),
            weeks: current.weeks + 1,
          }));
        } else
          setLoaded((current) => ({ ...current, weeks: current.weeks + 1 }));
      },
      { root: box, rootMargin: "400px 0px" },
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
  async function change(id: string, values: DragValues) {
    const original = data?.plans.find(
      (item) => `${item.id}~${item.occurrence_date}` === id,
    );
    if (!original || pending) return;
    setPending(true);
    try {
      const updated = await scheduleApi.update(original.id, {
        ...original,
        ...values,
        timezone: preferences.timezone,
        scope: original.frequency === "none" ? "series" : "occurrence",
        revision: original.revision,
        occurrence_date: original.occurrence_date,
      });
      void client.invalidateQueries({ queryKey: ["schedule"] });
      toast.success(
        original.frequency === "none"
          ? "Plan updated"
          : "Updated this occurrence; the series is unchanged",
        {
          action: {
            label: "Undo",
            onClick: () => {
              void (async () => {
                try {
                  if (original.frequency !== "none" && !original.is_override)
                    await scheduleApi.remove(
                      original.id,
                      updated.revision,
                      original.occurrence_date,
                      true,
                    );
                  else
                    await scheduleApi.update(original.id, {
                      ...original,
                      revision: updated.revision,
                      scope:
                        original.frequency === "none" ? "series" : "occurrence",
                      occurrence_date: original.occurrence_date,
                    });
                  void client.invalidateQueries({ queryKey: ["schedule"] });
                } catch (error) {
                  toast.error((error as Error).message);
                }
              })();
            },
          },
        },
      );
    } catch (error) {
      toast.error((error as Error).message);
      void client.invalidateQueries({ queryKey: ["schedule"] });
    } finally {
      setPending(false);
    }
  }
  /** Copies are always one-off plans, even when the original repeats. */
  async function copy(id: string, values: DragValues) {
    const original = data?.plans.find(
      (item) => `${item.id}~${item.occurrence_date}` === id,
    );
    if (!original || pending) return;
    setPending(true);
    try {
      const created = await scheduleApi.create({
        activity_id: values.activity_id ?? original.activity_id,
        title: original.title,
        date: values.date,
        start_minute: values.start_minute,
        end_minute: values.end_minute,
        timezone: preferences.timezone,
        notifications_enabled: original.notifications_enabled,
        notification_minutes: original.notification_minutes,
        frequency: "none",
        weekdays: [weekday(values.date)],
        repeat_until: null,
      });
      void client.invalidateQueries({ queryKey: ["schedule"] });
      toast.success(
        original.frequency === "none"
          ? "Plan copied"
          : "Copied this occurrence as a one-off plan",
        {
          action: {
            label: "Undo",
            onClick: () => {
              void scheduleApi
                .remove(created.id, created.revision)
                .then(() =>
                  client.invalidateQueries({ queryKey: ["schedule"] }),
                )
                .catch((error: Error) => toast.error(error.message));
            },
          },
        },
      );
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setPending(false);
    }
  }
  useScheduleGestures(root, { preferences, pending, create, change, copy });
  return (
    <>
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
        className="schedule-content"
        ref={root}
        aria-busy={pending || boards.some((board) => board.isFetching)}
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
                onClick={() => setDate(day)}
              >
                <span>{dayLabel(day, { weekday: "short" })}</span>
                <strong>{Number(day.slice(8))}</strong>
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
                for (const board of boards) void board.refetch();
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
              data={data}
              preferences={preferences}
              activities={activities.data ?? []}
              now={now}
              onPlan={(plan) => setEditing({ plan })}
              onSession={setSession}
              onReminder={onReminder}
              onDay={(day) => {
                setDate(day);
                setMode("day");
              }}
              onStart={(id) =>
                action.mutate({ action: "start", activityId: id })
              }
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
      </div>
      {editing && (
        <PlanDialog
          initial={editing.plan}
          anchorX={editing.anchorX}
          activities={activities.data ?? []}
          hours={preferences}
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
