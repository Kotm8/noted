import { useState } from "react";
import {
  AlarmClock,
  ArrowLeft,
  Play,
  RefreshCw,
  Square,
  X,
} from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Select } from "../../../components/ui/select";
import { Notice } from "../../../components/ui/notice";
import { type PlanPrompt, usePromptAction } from "../../schedule/prompts";
import type { Activity } from "../types";

export function PlannedTaskPrompt({
  prompt,
  activities,
  timezone,
  close,
}: {
  prompt: PlanPrompt;
  activities: Activity[];
  timezone: string;
  close: () => void;
}) {
  const [mode, setMode] = useState<"main" | "delay" | "other">("main");
  const [minutes, setMinutes] = useState(5);
  const [reason, setReason] = useState("Finishing up current task");
  const [custom, setCustom] = useState("");
  const ended = prompt.phase === "end";
  const alternatives = activities.filter(
    (item) => !item.archived && item.id !== prompt.activity_id,
  );
  const [activityId, setActivityId] = useState(alternatives[0]?.id ?? "");
  const action = usePromptAction(prompt);
  const ready =
    (reason === "custom" ? custom.trim() : reason).length > 0 &&
    (mode !== "other" || activityId !== "");
  return (
    <section
      className="planned-task-prompt"
      aria-label="Planned activity prompt"
      aria-live="polite"
    >
      <header>
        <span>
          <AlarmClock size={13} />
          {ended ? "ACTIVITY ENDED" : "PLANNED ACTIVITY"}
        </span>
        <button
          className="icon-button"
          aria-label="Collapse task prompt"
          onClick={close}
        >
          <X size={14} />
        </button>
      </header>
      <strong>{prompt.title}</strong>
      <p>
        {activities.find((item) => item.id === prompt.activity_id)?.name ??
          "Planned activity"}{" "}
        <span>
          · {ended ? "Ended at " : ""}
          {new Date(
            ended
              ? (prompt.planned_end ?? prompt.planned_start)
              : prompt.planned_start,
          ).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23",
            timeZone: timezone,
          })}
        </span>
      </p>
      {mode === "main" ? (
        <div className="plan-prompt-main-actions">
          <Button
            size="small"
            disabled={action.isPending}
            onClick={() =>
              action.mutate(
                { action: ended ? "stop" : "start" },
                { onSuccess: close },
              )
            }
          >
            {ended ? <Square size={14} /> : <Play size={14} />}
            {ended ? "No activity" : "Start activity"}
          </Button>
          <Button
            size="small"
            variant="secondary"
            disabled={action.isPending}
            onClick={() => setMode("delay")}
          >
            <AlarmClock size={14} />
            {ended ? "Snooze" : "Delay"}
          </Button>
          {!ended && alternatives.length > 0 && (
            <button
              className="plan-prompt-other"
              disabled={action.isPending}
              onClick={() => setMode("other")}
            >
              <RefreshCw size={13} />
              Choose another activity
            </button>
          )}
        </div>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (ready)
              action.mutate(
                {
                  action: mode,
                  minutes,
                  reason: reason === "custom" ? custom.trim() : reason,
                  ...(mode === "other" ? { activity_id: activityId } : {}),
                },
                { onSuccess: close },
              );
          }}
        >
          {mode === "other" && (
            <label>
              Working on
              <Select
                label="Current working activity"
                value={activityId}
                options={alternatives.map((item) => ({
                  value: item.id,
                  label: item.name,
                }))}
                onChange={setActivityId}
              />
            </label>
          )}
          <span className="field-caption">Remind me again in</span>
          <div
            className="plan-delay-choices"
            role="group"
            aria-label="Delay task prompt"
          >
            {[5, 10, 15, 30, 60].map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={value === minutes}
                onClick={() => setMinutes(value)}
              >
                {value === 60 ? "1 hour" : `${value} min`}
              </button>
            ))}
          </div>
          <label>
            Reason
            <Select
              label="Reason for delaying"
              value={reason}
              options={[
                { value: "", label: "Choose a reason" },
                {
                  value: "Finishing up current task",
                  label: "Finishing up current task",
                },
                { value: "Taking a break", label: "Taking a break" },
                { value: "Something came up", label: "Something came up" },
                { value: "custom", label: "Write a reason" },
              ]}
              onChange={setReason}
            />
          </label>
          {reason === "custom" && (
            <label>
              Your reason
              <textarea
                required
                maxLength={500}
                value={custom}
                onChange={(event) => setCustom(event.target.value)}
                rows={2}
              />
            </label>
          )}
          <small>The plan stays in its original place.</small>
          <div className="plan-prompt-form-actions">
            <Button
              type="button"
              variant="ghost"
              size="small"
              disabled={action.isPending}
              onClick={() => setMode("main")}
            >
              <ArrowLeft size={13} />
              Back
            </Button>
            <Button
              type="submit"
              size="small"
              disabled={!ready || action.isPending}
            >
              {mode === "other"
                ? "Switch & delay"
                : ended
                  ? "Snooze prompt"
                  : "Delay prompt"}
            </Button>
          </div>
        </form>
      )}
      {action.isError && <Notice tone="error">{action.error.message}</Notice>}
    </section>
  );
}
