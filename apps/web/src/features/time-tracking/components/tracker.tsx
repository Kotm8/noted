import { useEffect, useId, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  Check,
  ChevronDown,
  Pause,
  Play,
  Plus,
  Square,
  Timer,
  X,
} from "lucide-react";
import { ActivityIcon } from "./activity-icon";
import { useTracking } from "../use-tracking";
import { usePlanPrompts } from "../../schedule/prompts";
import { useAndroidBackLayer } from "../../../lib/android-navigation";
import { PlannedTaskPrompt } from "./planned-task-prompt";

export function TimeTracker({ onSettings }: { onSettings: () => void }) {
  const { tracker, activities, action } = useTracking();
  const [expanded, setExpanded] = useState(false);
  const prompts = usePlanPrompts();
  const location = useLocation();
  const preferred = new URLSearchParams(location.search).get("prompt");
  const prompt =
    prompts.data?.find((item) => item.id === preferred) ?? prompts.data?.[0];
  const [closedPrompt, setClosedPrompt] = useState("");
  const promptKey = prompt ? `${prompt.id}:${prompt.revision}` : "";
  const showPrompt = Boolean(prompt && promptKey !== closedPrompt);
  const open = expanded || showPrompt;
  const collapse = () => {
    setClosedPrompt(promptKey);
    setExpanded(false);
  };
  useAndroidBackLayer(expanded, collapse);
  useEffect(() => {
    const expand = () => {
      setExpanded(true);
      setClosedPrompt(promptKey);
    };
    window.addEventListener("noted:choose-activity", expand);
    return () => window.removeEventListener("noted:choose-activity", expand);
  }, [promptKey]);
  const [now, setNow] = useState(Date.now());
  const id = useId();
  const data = tracker.data;
  useEffect(() => {
    if (!data?.active?.id) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [data?.active?.id]);
  const current = activities.data?.find(
    (item) =>
      item.id === (data?.active?.activity_id ?? data?.paused_activity_id),
  );
  const elapsed =
    (data?.elapsed_seconds ?? 0) +
    (data?.active
      ? Math.max(0, Math.floor((now - tracker.dataUpdatedAt) / 1000))
      : 0);
  const clock = [
    Math.floor(elapsed / 3600),
    Math.floor(elapsed / 60) % 60,
    elapsed % 60,
  ]
    .map((number) => String(number).padStart(2, "0"))
    .join(":");
  return (
    <div
      className={`time-tracker ${data?.active ? "is-running" : ""}`}
      data-expanded={open}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          event.stopPropagation();
          collapse();
        }
      }}
    >
      <button
        className="tracker-trigger"
        aria-label="Choose current activity"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          if (open) collapse();
          else if (prompt) setClosedPrompt("");
          else setExpanded(true);
        }}
      >
        {current ? <ActivityIcon activity={current} /> : <Timer size={20} />}
        <span className="tracker-label">
          <strong>{current?.name ?? "What are you doing?"}</strong>
          {current ? (
            <span>
              <time className="tracker-elapsed">{clock}</time>
              <small>{data?.active ? "Tracking" : "Paused"}</small>
            </span>
          ) : (
            <small>
              {prompt
                ? "A planned activity is ready"
                : tracker.isError
                  ? "Reconnect to track time"
                  : tracker.isPending
                    ? "Connecting…"
                    : "Start tracking your time"}
            </small>
          )}
        </span>
        <ChevronDown size={14} />
      </button>
      {prompt && !open && (
        <button
          className="tracker-prompt-badge"
          onClick={() => setClosedPrompt("")}
        >
          Planned: {prompt.title}
        </button>
      )}
      <div className="tracker-expansion" inert={!open}>
        <div className="tracker-expansion-inner">
          {showPrompt && prompt ? (
            <div id={id}>
              <PlannedTaskPrompt
                key={promptKey}
                prompt={prompt}
                activities={activities.data ?? []}
                timezone={data?.preferences.timezone ?? "UTC"}
                close={collapse}
              />
            </div>
          ) : (
            <section id={id} aria-label="Choose activity">
              <div className="tracker-picker-heading">
                <span>SWITCH ACTIVITY</span>
                <button
                  className="icon-button"
                  aria-label="Close activity picker"
                  onClick={() => setExpanded(false)}
                >
                  <X size={13} />
                </button>
              </div>
              <div className="tracker-activities">
                {activities.data
                  ?.filter((item) => !item.archived)
                  .map((item) => (
                    <button
                      className={
                        data?.active?.activity_id === item.id ? "active" : ""
                      }
                      key={item.id}
                      disabled={action.isPending || !data}
                      onClick={() =>
                        action.mutate(
                          { action: "start", activityId: item.id },
                          { onSuccess: () => setExpanded(false) },
                        )
                      }
                    >
                      <ActivityIcon activity={item} />
                      <span>{item.name}</span>
                      {data?.active?.activity_id === item.id ? (
                        <Check size={14} />
                      ) : (
                        <Play size={13} />
                      )}
                    </button>
                  ))}
                {!activities.data?.some((item) => !item.archived) && (
                  <p>Add your first activity in Settings.</p>
                )}
              </div>
              <button
                className="tracker-manage"
                onClick={() => {
                  setExpanded(false);
                  onSettings();
                }}
              >
                <Plus size={13} />
                Manage activities
              </button>
            </section>
          )}
        </div>
      </div>
      {current && (
        <div className="tracker-transport">
          <span>{data?.active ? "Session in progress" : "Timer paused"}</span>
          <button
            className="icon-button"
            disabled={action.isPending}
            aria-label={data?.active ? "Pause timer" : "Resume timer"}
            onClick={() =>
              action.mutate({ action: data?.active ? "pause" : "resume" })
            }
          >
            {data?.active ? <Pause size={14} /> : <Play size={14} />}
          </button>
          <button
            className="icon-button"
            disabled={action.isPending}
            aria-label="Stop timer"
            onClick={() => action.mutate({ action: "stop" })}
          >
            <Square size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
