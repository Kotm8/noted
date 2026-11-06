import { isDayOff } from "../time-tracking/work-schedule";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import {
  Bell,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Clock,
  Menu,
  Plus,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "../../components/ui/button";
import { AssistantButton } from "../ai/assistant/assistant-button";
import { Notice } from "../../components/ui/notice";
import { liveInterval } from "../../lib/live";
import { useWorkspaceShell } from "../workspaces/shell-context";
import { useTracking } from "../time-tracking/use-tracking";
import {
  addDays,
  dayLabel,
  minuteLabel,
  weekDays,
  zonedParts,
} from "../schedule/dates";
import { habitsApi } from "./api";
import type { Habit, HabitBoard } from "./types";
import { HabitEditor } from "./habit-editor";
import { HabitDetails } from "./habit-details";

export function HabitsPage() {
  const shell = useWorkspaceShell();
  const tracking = useTracking();
  const client = useQueryClient();
  const [params] = useSearchParams();
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  const timezone =
    tracking.tracker.data?.preferences.timezone ??
    Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = zonedParts(clock, timezone).date;
  const [selectedDay, setSelectedDay] = useState<string | null>(() =>
    /^\d{4}-\d{2}-\d{2}$/.test(params.get("day") ?? "")
      ? params.get("day")
      : null,
  );
  const day = selectedDay ?? today;
  const days = weekDays(day);
  const board = useQuery({
    queryKey: ["habits", days[0], days[6]],
    queryFn: () => habitsApi.board(days[0], days[6]),
    refetchInterval: () => liveInterval(30000),
  });
  const [editing, setEditing] = useState<Habit | null | undefined>(undefined);
  const [detail, setDetail] = useState<string | null>(params.get("habit"));
  const [pending, setPending] = useState<string | null>(null);
  const busy = useRef(false);
  const habits = board.data?.habits ?? [];
  const progress = (habit: Habit, date = day) =>
    board.data?.progress.find(
      (item) => item.habit_id === habit.id && item.day === date,
    );
  const summary = (date: string) => {
    const items = habits.filter((habit) => progress(habit, date)?.due);
    return {
      total: items.length,
      done: items.filter(
        (habit) => (progress(habit, date)?.value ?? 0) >= habit.goal,
      ).length,
    };
  };
  const total = summary(day);
  async function refresh() {
    await client.invalidateQueries({ queryKey: ["habits"] });
  }
  async function update(habit: Habit, value: number) {
    const current = progress(habit);
    if (busy.current || habit.activity_id || !current?.due || day > today)
      return;
    busy.current = true;
    setPending(habit.id);
    const key = ["habits", days[0], days[6]];
    const before = client.getQueryData<HabitBoard>(key);
    client.setQueryData<HabitBoard>(
      key,
      (board) =>
        board && {
          ...board,
          progress: board.progress.map((entry) =>
            entry.habit_id === habit.id && entry.day === day
              ? { ...entry, value }
              : entry,
          ),
        },
    );
    try {
      await habitsApi.progress(habit.id, day, value, current.revision);
      await refresh();
    } catch (error) {
      if (before) client.setQueryData(key, before);
      toast.error((error as Error).message);
      await refresh();
    } finally {
      busy.current = false;
      setPending(null);
    }
  }
  async function remove(habit: Habit) {
    setPending(habit.id);
    try {
      await habitsApi.remove(habit);
      setDetail(null);
      await refresh();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setPending(null);
    }
  }
  const selected = habits.find((habit) => habit.id === detail);
  function bar(value: number, goal: number) {
    return (
      <span className="habit-progress-bar">
        <span
          style={{
            width: `${Math.min(100, (value / Math.max(goal, 1)) * 100)}%`,
          }}
        />
      </span>
    );
  }
  return (
    <>
      <header className="channel-header">
        <button
          className="icon-button mobile-menu"
          aria-label="Open navigation"
          onClick={shell.openNavigation}
        >
          <Menu size={20} />
        </button>
        <div className="channel-heading">
          <CheckSquare size={18} />
          <h1>Habits</h1>
        </div>
        <div className="header-actions">
          <AssistantButton />
        </div>
      </header>
      <div className="habits-scroll">
        <div className="habits-heading">
          <h2>
            {day === today ? "Today" : dayLabel(day, { weekday: "long" })}
          </h2>
          <p>
            {dayLabel(day, { weekday: "long", day: "numeric", month: "long" })}
          </p>
        </div>
        {board.error && (
          <Notice tone="error">
            {board.error.message}
            <button onClick={() => void board.refetch()}>Retry</button>
          </Notice>
        )}
        <div className="habits-layout">
          <section className="habits-routine">
            <div className="habits-total">
              <span>
                <strong>{total.done}</strong> / {total.total} done
              </span>
              {bar(total.done, total.total)}
            </div>
            {board.isPending ? (
              <p className="habit-help">Loading habits…</p>
            ) : habits.length === 0 ? (
              <p className="habit-help">
                No habits yet. Add your first habit below.
              </p>
            ) : (
              (["Morning", "Anytime", "Evening"] as const).map((period) => {
                const items = habits.filter(
                  (habit) => habit.period === period && progress(habit)?.due,
                );
                return (
                  <section key={period} className="habits-group">
                    <h3>{period}</h3>
                    {items.length === 0 ? (
                      <p className="habit-help">No habits.</p>
                    ) : (
                      items.map((habit) => {
                        const value = progress(habit)?.value ?? 0;
                        const done = value >= habit.goal;
                        const linked = tracking.activities.data?.find(
                          (item) => item.id === habit.activity_id,
                        );
                        const disabled = pending !== null || day > today;
                        return (
                          <div
                            className={`habit-row${done ? " is-done" : ""}`}
                            key={habit.id}
                          >
                            <input
                              className="habit-checkbox"
                              type="checkbox"
                              aria-label={habit.name}
                              checked={done}
                              disabled={disabled || Boolean(habit.activity_id)}
                              onChange={() =>
                                void update(habit, done ? 0 : habit.goal)
                              }
                            />
                            <button
                              className="habit-name-button"
                              onClick={() => setDetail(habit.id)}
                            >
                              <span>{habit.name}</span>
                              {(linked || habit.reminder_minute !== null) && (
                                <small>
                                  {linked && (
                                    <>
                                      <Clock size={12} />
                                      {linked.name}
                                      <span>Automatic</span>
                                    </>
                                  )}
                                  {habit.reminder_minute !== null && (
                                    <span>
                                      <Bell size={12} />
                                      {minuteLabel(habit.reminder_minute)}
                                    </span>
                                  )}
                                </small>
                              )}
                            </button>
                            {habit.kind !== "check" && (
                              <button
                                className={`habit-count${habit.activity_id ? " automatic" : ""}`}
                                disabled={
                                  disabled || (!habit.activity_id && done)
                                }
                                aria-label={
                                  habit.activity_id
                                    ? `View ${habit.name} progress`
                                    : `Add ${habit.kind === "time" ? 5 : 1} ${habit.unit} to ${habit.name}`
                                }
                                onClick={() =>
                                  habit.activity_id
                                    ? setDetail(habit.id)
                                    : void update(
                                        habit,
                                        Math.min(
                                          habit.goal,
                                          value +
                                            (habit.kind === "time" ? 5 : 1),
                                        ),
                                      )
                                }
                              >
                                <strong>{Number(value.toFixed(1))}</strong>
                                <span>/ {habit.goal}</span>
                                <small>{habit.unit}</small>
                                {habit.activity_id ? (
                                  <Clock size={14} />
                                ) : (
                                  <Plus size={14} />
                                )}
                              </button>
                            )}
                          </div>
                        );
                      })
                    )}
                  </section>
                );
              })
            )}
            <Button onClick={() => setEditing(null)} disabled={board.isPending}>
              <Plus size={15} />
              Add habit
            </Button>
          </section>
          <aside className="habits-week">
            <header>
              <h3>This week</h3>
              <div>
                <button
                  className="icon-button"
                  aria-label="Previous week"
                  onClick={() => setSelectedDay(addDays(day, -7))}
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  className="icon-button"
                  aria-label="Next week"
                  onClick={() => setSelectedDay(addDays(day, 7))}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </header>
            <div className="habits-week-days">
              {days.map((date) => {
                const off = isDayOff(
                  date,
                  tracking.tracker.data?.preferences.work_schedule,
                );
                const stats = summary(date);
                return (
                  <button
                    className={`${date === day ? "selected" : ""} ${off ? "day-off" : ""}`}
                    key={date}
                    aria-pressed={date === day}
                    aria-label={dayLabel(date, {
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                    })}
                    onClick={() => {
                      setSelectedDay(date);
                      setDetail(null);
                    }}
                  >
                    <span className="habit-day-date">
                      <small>{dayLabel(date, { weekday: "short" })}</small>
                      <strong>{Number(date.slice(8))}</strong>
                    </span>
                    <span className="habit-day-status">
                      <span>
                        {date === today
                          ? "Today"
                          : off
                            ? "Day off"
                            : dayLabel(date, { weekday: "long" })}
                      </span>
                      {bar(stats.done, stats.total)}
                    </span>
                    <small className="habit-day-total">
                      {date > today ? "" : `${stats.done}/${stats.total}`}
                    </small>
                  </button>
                );
              })}
            </div>
            <Button
              variant="ghost"
              size="small"
              onClick={() => setSelectedDay(null)}
            >
              Today
            </Button>
          </aside>
        </div>
      </div>
      {selected && (
        <HabitDetails
          key={`${selected.id}-${day}-${progress(selected)?.revision}`}
          habit={selected}
          progress={progress(selected)}
          activity={
            tracking.activities.data?.find(
              (item) => item.id === selected.activity_id,
            )?.name
          }
          day={day}
          pending={pending !== null}
          onClose={() => setDetail(null)}
          onEdit={() => setEditing(selected)}
          onProgress={(value) => void update(selected, value)}
          onDelete={() => void remove(selected)}
          onTrack={() =>
            tracking.action.mutate({
              action: "start",
              activityId: selected.activity_id!,
            })
          }
        />
      )}
      {editing !== undefined && (
        <HabitEditor
          habit={editing}
          activities={tracking.activities.data ?? []}
          today={today}
          timezone={timezone}
          onClose={() => setEditing(undefined)}
          onSaved={() => void refresh()}
        />
      )}
    </>
  );
}
