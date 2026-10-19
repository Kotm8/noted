import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
  minuteLabel,
  wallTime,
  weekDays,
  zonedParts,
} from "./dates";
import { CalendarGrid } from "./components/calendar-grid";
import { PlanDialog } from "./components/plan-dialog";
import { SessionEditor } from "./components/session-editor";
import type { PlanFields, PlanOccurrence, ReminderFlag } from "./types";
import { useScheduleGestures } from "./use-schedule-gestures";
import type { DragValues } from "./use-schedule-gestures";

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
  const [editing, setEditing] = useState<PlanFields | PlanOccurrence | null>(
    null,
  );
  const [session, setSession] = useState<TimeSession | null>(null);
  const [pending, setPending] = useState(false);
  const [now, setNow] = useState(Date.now());
  const root = useRef<HTMLDivElement>(null);
  const client = useQueryClient();
  const days = mode === "week" ? weekDays(date) : [date];
  const start = wallTime(days[0], 0, preferences.timezone);
  const end = wallTime(addDays(days.at(-1)!, 1), 0, preferences.timezone);
  const board = useQuery({
    queryKey: ["schedule", start, end],
    queryFn: () => scheduleApi.board(start, end),
    enabled: Boolean(tracker.data),
    refetchInterval: () =>
      document.body.classList.contains("schedule-dragging") || pending
        ? false
        : 15000,
  });
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
      activity_id: activityId,
      title: "",
      date: values.date,
      start_minute: values.start_minute,
      end_minute: values.end_minute,
      timezone: preferences.timezone,
      frequency: "none",
      weekdays: [(new Date(`${values.date}T12:00:00Z`).getUTCDay() + 6) % 7],
      repeat_until: null,
    });
  }
  async function change(id: string, values: DragValues) {
    const original = board.data?.plans.find(
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
  useScheduleGestures(root, { preferences, pending, create, change });
  const data = board.data;
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
        aria-busy={pending || board.isFetching}
      >
        <div className="schedule-toolbar">
          <div className="schedule-date-navigation">
            <button
              className="icon-button"
              aria-label={mode === "week" ? "Previous week" : "Previous day"}
              onClick={() => setDate(addDays(date, mode === "week" ? -7 : -1))}
            >
              <ChevronLeft size={16} />
            </button>
            <button
              className="icon-button"
              aria-label={mode === "week" ? "Next week" : "Next day"}
              onClick={() => setDate(addDays(date, mode === "week" ? 7 : 1))}
            >
              <ChevronRight size={16} />
            </button>
            <DatePicker
              label="Choose displayed date"
              displayLabel={
                mode === "week"
                  ? dateRangeLabel(days[0], days.at(-1)!)
                  : dayLabel(date, {
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                    })
              }
              value={date}
              onChange={setDate}
            />
            <Button
              variant="ghost"
              size="small"
              onClick={() =>
                setDate(zonedParts(Date.now(), preferences.timezone).date)
              }
            >
              Today
            </Button>
          </div>
          <div className="schedule-toolbar-actions">
            <div className="schedule-view-switch" aria-label="Calendar view">
              <button
                aria-pressed={mode === "week"}
                onClick={() => setMode("week")}
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
                  start_minute: preferences.start_minute,
                  end_minute: preferences.start_minute + 60,
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
        {(board.error || tracker.error || activities.error) && (
          <Notice tone="error">
            {(board.error ?? tracker.error ?? activities.error)?.message}
            <Button
              variant="ghost"
              size="small"
              onClick={() => {
                void board.refetch();
                void tracker.refetch();
                void activities.refetch();
              }}
            >
              Retry
            </Button>
          </Notice>
        )}
        {board.isPending && !board.error && (
          <p className="schedule-loading">Loading your schedule…</p>
        )}
        {data && (
          <CalendarGrid
            days={days}
            selected={date}
            mode={mode}
            data={data}
            preferences={preferences}
            activities={activities.data ?? []}
            now={now}
            onPlan={setEditing}
            onSession={setSession}
            onReminder={onReminder}
            onDay={(day) => {
              setDate(day);
              setMode("day");
            }}
            onStart={(id) => action.mutate({ action: "start", activityId: id })}
          />
        )}
        <footer className="schedule-footer">
          <span>
            <MousePointer2 size={13} />
            Click to plan · drag to draw or move · edges to resize · 15-minute
            steps
          </span>
          <span>
            <Info size={13} />
            Times use {preferences.timezone}
          </span>
        </footer>
      </div>
      {editing && (
        <PlanDialog
          initial={editing}
          activities={activities.data ?? []}
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
