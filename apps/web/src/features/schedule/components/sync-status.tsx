import { CloudUpload, Info } from "lucide-react";
import type { ScheduleWrites } from "../use-schedule-writes";

export function ScheduleSyncStatus({
  writes,
  onReview,
}: {
  writes: ScheduleWrites;
  onReview: (state: ScheduleWrites["failures"][number]) => void;
}) {
  if (!writes.pending.length && !writes.failures.length) return null;
  return (
    <div className="schedule-sync-status" aria-live="polite">
      {writes.pending.length > 0 && (
        <p role="status">
          <CloudUpload size={14} />
          Saving {writes.pending.length}{" "}
          {writes.pending.length === 1 ? "change" : "changes"} in the
          background…
        </p>
      )}
      {writes.failures.map((state) => (
        <div className="schedule-sync-failure" key={state.id}>
          <Info size={14} />
          <span>
            <strong>{state.write.plan.title}</strong> could not be saved.{" "}
            {state.error?.message}
          </span>
          <button type="button" onClick={() => onReview(state)}>
            Review
          </button>
          <button
            type="button"
            onClick={() => writes.retry(state.id, state.write)}
          >
            Retry
          </button>
          <button type="button" onClick={() => writes.forget(state.id)}>
            Dismiss
          </button>
        </div>
      ))}
    </div>
  );
}
