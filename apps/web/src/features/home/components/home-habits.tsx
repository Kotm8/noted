import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronRight, Clock, Minus, Plus } from "lucide-react";
import { toast } from "sonner";
import { liveInterval } from "../../../lib/live";
import { Notice } from "../../../components/ui/notice";
import { habitsApi } from "../../habits/api";
import type { Habit, HabitProgress } from "../../habits/types";

export function HomeHabits({
  today,
  onOpen,
  compact = false,
}: {
  today: string;
  onOpen: () => void;
  compact?: boolean;
}) {
  const client = useQueryClient();
  const board = useQuery({
    queryKey: ["habits", today, today],
    queryFn: () => habitsApi.board(today, today),
    refetchInterval: () => liveInterval(30000),
  });
  const update = useMutation({
    mutationFn: ({
      habit,
      progress,
      value,
    }: {
      habit: Habit;
      progress: HabitProgress;
      value: number;
    }) => habitsApi.progress(habit.id, today, value, progress.revision),
    onError: (error) => toast.error(error.message),
    onSettled: () => client.invalidateQueries({ queryKey: ["habits"] }),
  });
  const due = (board.data?.habits ?? []).flatMap((habit) => {
    const progress = board.data?.progress.find(
      (item) => item.habit_id === habit.id && item.due,
    );
    return progress
      ? [{ habit, progress, done: progress.value >= habit.goal }]
      : [];
  });
  const complete = due.filter((item) => item.done).length;
  const visible = compact
    ? [
        ...due.filter((item) => !item.done),
        ...due.filter((item) => item.done),
      ].slice(0, 2)
    : due;
  return (
    <section
      className="home-b-section home-b-habits"
      aria-label="Today's habits"
    >
      <div className="home-b-section-heading">
        <h2>Habits</h2>
        <button className="home-text-button" onClick={onOpen}>
          {compact && due.length > visible.length
            ? `+${due.length - visible.length} more`
            : "All"}
          <ChevronRight size={13} />
        </button>
      </div>
      {board.isPending && <p className="home-empty">Loading habits…</p>}
      {board.error && (
        <Notice tone="error">
          {board.error.message}
          <button onClick={() => void board.refetch()}>Retry</button>
        </Notice>
      )}
      {compact && due.length > 0 && (
        <div className="phone-habits-progress">
          <strong>
            {complete} of {due.length} complete
          </strong>
          <progress
            max={due.length}
            value={complete}
            aria-label="Today's habits completed"
          />
        </div>
      )}
      {visible.map(({ habit, progress, done }) => {
        const change = (value: number) =>
          update.mutate({
            habit,
            progress,
            value: Math.max(0, Math.min(habit.goal, value)),
          });
        return (
          <div
            className={`home-habit-row ${done ? "complete" : ""}`}
            key={habit.id}
          >
            {habit.kind === "check" && !habit.activity_id ? (
              <button
                role="checkbox"
                aria-checked={done}
                aria-label={habit.name}
                disabled={update.isPending}
                className="home-check"
                onClick={() => change(done ? 0 : habit.goal)}
              >
                {done && <Check size={13} />}
              </button>
            ) : (
              <span className="home-habit-marker">
                {habit.activity_id ? (
                  <Clock size={14} />
                ) : (
                  <span className="home-check" aria-hidden="true">
                    {done && <Check size={13} />}
                  </span>
                )}
              </span>
            )}
            <button
              className="home-habit-name"
              onClick={
                habit.kind === "check" && !habit.activity_id
                  ? () => change(done ? 0 : habit.goal)
                  : onOpen
              }
              disabled={update.isPending && habit.kind === "check"}
            >
              {habit.name}
            </button>
            {habit.kind !== "check" && (
              <div
                className="home-habit-count"
                aria-label={`${habit.name} progress`}
              >
                <span
                  title={
                    habit.activity_id
                      ? "Updated automatically from tracked activity"
                      : habit.unit
                  }
                >
                  {Number(progress.value.toFixed(1))}
                  <small>/{habit.goal}</small>
                  {habit.kind === "time" && <small> min</small>}
                </span>
                {!habit.activity_id && (
                  <>
                    <button
                      className="home-small-button"
                      data-adjust="decrease"
                      disabled={update.isPending || progress.value <= 0}
                      aria-label={`Decrease ${habit.name}`}
                      onClick={() =>
                        change(progress.value - (habit.kind === "time" ? 5 : 1))
                      }
                    >
                      <Minus size={13} />
                    </button>
                    <button
                      className="home-small-button"
                      disabled={update.isPending || done}
                      aria-label={`Increase ${habit.name}`}
                      onClick={() =>
                        change(progress.value + (habit.kind === "time" ? 5 : 1))
                      }
                    >
                      <Plus size={13} />
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
      {board.data && !due.length && (
        <p className="home-empty">
          No habits due today.{" "}
          <button className="home-text-button" onClick={onOpen}>
            Open habits
          </button>
        </p>
      )}
    </section>
  );
}
