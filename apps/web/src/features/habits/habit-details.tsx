import { useState } from "react";
import { Clock, Pencil, X } from "lucide-react";
import { Button } from "../../components/ui/button";
import { useAndroidBackLayer } from "../../lib/android-navigation";
import type { Habit, HabitProgress } from "./types";

export function HabitDetails({
  habit,
  progress,
  activity,
  day,
  pending,
  onClose,
  onEdit,
  onProgress,
  onTrack,
  onDelete,
}: {
  habit: Habit;
  progress?: HabitProgress;
  activity?: string;
  day: string;
  pending: boolean;
  onClose: () => void;
  onEdit: () => void;
  onProgress: (value: number) => void;
  onTrack: () => void;
  onDelete: () => void;
}) {
  useAndroidBackLayer(true, onClose);
  const [value, setValue] = useState(progress?.value ?? 0);
  const [confirm, setConfirm] = useState(false);
  return (
    <aside className="habit-details" aria-label="Habit details">
      <header>
        <strong>{habit.name}</strong>
        <button
          className="icon-button"
          aria-label="Close habit details"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </header>
      <p>{day}</p>
      <div className="habit-detail-total">
        {progress?.value ?? 0}
        <small>
          {" "}
          / {habit.goal} {habit.kind === "check" ? "done" : habit.unit}
        </small>
      </div>
      {activity ? (
        <>
          <p className="habit-help">
            <Clock size={14} /> Minutes from {activity} count automatically.
          </p>
          <Button onClick={onTrack} disabled={pending}>
            Track {activity}
          </Button>
        </>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onProgress(value);
          }}
        >
          <label>
            Progress
            <input
              type="number"
              min="0"
              max="100000"
              step="any"
              value={value}
              onChange={(event) => setValue(Number(event.target.value))}
            />
          </label>
          <Button disabled={pending || !progress?.due}>Save progress</Button>
        </form>
      )}
      <Button variant="ghost" onClick={onEdit}>
        <Pencil size={15} />
        Edit habit
      </Button>
      <div className="habit-remove">
        <button className="text-danger" onClick={() => setConfirm(true)}>
          Remove habit
        </button>
        {confirm && (
          <>
            <p>Remove this habit from your list? Existing history is kept.</p>
            <Button disabled={pending} onClick={onDelete}>
              Remove
            </Button>
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
          </>
        )}
      </div>
    </aside>
  );
}
