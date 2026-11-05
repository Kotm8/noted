import { FieldChanges } from "./field-changes";
import { scheduleApi } from "../../schedule/api";
import { useTracking } from "../../time-tracking/use-tracking";
import { useEffect, useRef } from "react";
import { ArrowUp, Check, Settings, Sparkles, Square, X } from "lucide-react";
import { useQuery, useQueries } from "@tanstack/react-query";
import { Button } from "../../../components/ui/button";
import { Notice } from "../../../components/ui/notice";
import { DatePicker } from "../../../components/ui/date-picker";
import { useAndroidBackLayer } from "../../../lib/android-navigation";
import { habitsApi } from "../../habits/api";
import { dayLabel, minuteLabel } from "../../schedule/dates";
import type { useSharedAssistant } from "./use-assistant";

export function AssistantPanel({
  assistant: a,
}: {
  assistant: ReturnType<typeof useSharedAssistant>;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  useAndroidBackLayer(a.open, () => a.setOpen(false));
  useEffect(() => {
    scroll.current?.scrollTo({ top: scroll.current.scrollHeight });
  }, [a.proposal, a.busy]);
  const habits = useQuery({
    queryKey: ["habits", "assistant-context", a.scope?.start, a.scope?.end],
    queryFn: () => habitsApi.board(a.scope!.start, a.scope!.end),
    enabled: a.open && Boolean(a.scope),
  });
  const tracking = useTracking();
  const activityNames = new Map(
    (tracking.activities.data ?? []).map((item) => [item.id, item.name]),
  );
  const existingPlans = useQueries({
    queries: (a.proposal?.plans ?? [])
      .filter((item) => item.id)
      .map((item) => ({
        queryKey: ["schedule-plan", item.id],
        queryFn: () => scheduleApi.get(item.id!),
        enabled: a.open,
      })),
  });
  if (!a.open) return null;
  return (
    <aside
      className="shared-ai-panel"
      aria-label="AI assistant"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          a.setOpen(false);
        }
      }}
    >
      <header>
        <Sparkles size={16} />
        <strong>Assistant</strong>
        <button
          className="icon-button"
          aria-label="AI settings"
          onClick={() => window.dispatchEvent(new Event("noted:ai-settings"))}
        >
          <Settings size={16} />
        </button>
        <button
          className="icon-button"
          aria-label="Close assistant"
          onClick={() => a.setOpen(false)}
        >
          <X size={18} />
        </button>
      </header>
      <div className="shared-ai-scroll" ref={scroll}>
        {a.scope && (
          <details className="shared-ai-range">
            <summary>
              {dayLabel(a.scope.start, { day: "numeric", month: "short" })} to{" "}
              {dayLabel(a.scope.end, { day: "numeric", month: "short" })}
            </summary>
            <label>
              From
              <DatePicker
                value={a.scope.start}
                label="AI start date"
                onChange={(start) => a.setScope({ ...a.scope!, start })}
              />
            </label>
            <label>
              To
              <DatePicker
                value={a.scope.end}
                label="AI end date"
                onChange={(end) => a.setScope({ ...a.scope!, end })}
              />
            </label>
          </details>
        )}
        {a.turns.length === 0 && (
          <p className="shared-ai-intro">
            Ask about your notes, habits, meals or calendar. Changes appear here
            for review.
          </p>
        )}
        {a.turns.map((turn, i) => (
          <p className={`shared-ai-turn ${turn.role}`} key={i}>
            {turn.role === "assistant"
              ? (() => {
                  try {
                    return JSON.parse(turn.content).explanation;
                  } catch {
                    return turn.content;
                  }
                })()
              : turn.content}
          </p>
        ))}
        {a.busy && (
          <p className="habit-help" role="status">
            {a.stage}
          </p>
        )}
        {a.proposal && (
          <div className="shared-ai-changes">
            {a.proposal.habits.map((change, index) => {
              const old = habits.data?.habits.find(
                (item) => item.id === change.id,
              );
              return (
                <label className="shared-ai-change" key={`habit-${index}`}>
                  <input
                    type="checkbox"
                    aria-label={`Include ${change.fields.name}`}
                    disabled={a.applied || a.applying || a.retryPending}
                    checked={a.selected.has(`habit-${index}`)}
                    onChange={(event) =>
                      a.setSelected((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(`habit-${index}`);
                        else next.delete(`habit-${index}`);
                        return next;
                      })
                    }
                  />
                  <span>
                    <small>{change.id ? "Edit habit" : "New habit"}</small>
                    <strong>{change.fields.name}</strong>
                    {old && (
                      <small>
                        Current: {old.goal} {old.unit},{" "}
                        {old.weekdays
                          .map(
                            (i) =>
                              ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][
                                i
                              ],
                          )
                          .join(", ")}
                      </small>
                    )}
                    <span>
                      {change.fields.kind === "check"
                        ? "Check off"
                        : `${change.fields.goal} ${change.fields.unit}`}{" "}
                      ·{" "}
                      {change.fields.weekdays
                        .map(
                          (i) =>
                            ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][
                              i
                            ],
                        )
                        .join(", ")}
                    </span>
                    <FieldChanges
                      before={old}
                      after={change.fields}
                      activities={activityNames}
                    />
                    <small>
                      {change.fields.reminder_minute === null
                        ? "Reminders off"
                        : `Reminder ${minuteLabel(change.fields.reminder_minute)}`}
                    </small>
                  </span>
                </label>
              );
            })}
            {a.proposal.meals.map((change, index) => {
              const total = change.fields.items.reduce(
                (sum, item) => sum + item.kcal,
                0,
              );
              return (
                <label className="shared-ai-change" key={`meal-${index}`}>
                  <input
                    type="checkbox"
                    aria-label={`Include ${change.fields.name}`}
                    disabled={a.applied || a.applying || a.retryPending}
                    checked={a.selected.has(`meal-${index}`)}
                    onChange={(event) =>
                      a.setSelected((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(`meal-${index}`);
                        else next.delete(`meal-${index}`);
                        return next;
                      })
                    }
                  />
                  <span>
                    <small>{change.id ? "Edit meal" : "Log meal"}</small>
                    <strong>{change.fields.name}</strong>
                    <span>
                      {change.fields.slot} ·{" "}
                      {String(Math.floor(change.fields.minute / 60)).padStart(
                        2,
                        "0",
                      )}
                      :{String(change.fields.minute % 60).padStart(2, "0")} ·{" "}
                      {Math.round(total).toLocaleString("en-GB")} kcal
                      {change.picture && " · makes a picture"}
                    </span>
                    <small>
                      {change.fields.items
                        .map((item) => `${item.name} ${item.kcal}`)
                        .join(" · ")}
                    </small>
                  </span>
                </label>
              );
            })}
            {a.proposal.plans.map((change, index) => (
              <label className="shared-ai-change" key={`plan-${index}`}>
                <input
                  type="checkbox"
                  aria-label={`Include ${change.fields.title}`}
                  disabled={a.applied || a.applying || a.retryPending}
                  checked={a.selected.has(`plan-${index}`)}
                  onChange={(event) =>
                    a.setSelected((current) => {
                      const next = new Set(current);
                      if (event.target.checked) next.add(`plan-${index}`);
                      else next.delete(`plan-${index}`);
                      return next;
                    })
                  }
                />
                <span>
                  <small>
                    {change.id
                      ? change.scope === "occurrence"
                        ? "Edit this occurrence"
                        : "Edit calendar plan"
                      : "New calendar plan"}
                  </small>
                  <button
                    type="button"
                    className="shared-ai-plan-title"
                    disabled={
                      a.applied || a.applying || a.retryPending || a.busy
                    }
                    onClick={(event) => {
                      event.preventDefault();
                      window.dispatchEvent(
                        new CustomEvent("noted:assistant-edit-plan", {
                          detail: {
                            index,
                            anchor: event.currentTarget.getBoundingClientRect(),
                          },
                        }),
                      );
                    }}
                  >
                    {change.fields.title}
                  </button>
                  <span>
                    {dayLabel(change.fields.date, {
                      day: "numeric",
                      month: "short",
                    })}{" "}
                    · {minuteLabel(change.fields.start_minute)}–
                    {minuteLabel(change.fields.end_minute)}
                  </span>
                  {a.conflicts.has(`assistant-${index}`) && (
                    <span className="shared-ai-conflict">
                      <span>{a.conflicts.get(`assistant-${index}`)}</span>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.preventDefault();
                          a.findGap(index);
                        }}
                      >
                        Find a gap
                      </button>
                    </span>
                  )}
                  <FieldChanges
                    before={
                      existingPlans.find(
                        (query) => query.data?.id === change.id,
                      )?.data
                    }
                    after={change.fields}
                    activities={activityNames}
                  />
                  <small>
                    {change.fields.frequency === "none"
                      ? "One-off"
                      : change.fields.frequency}{" "}
                    · {change.fields.timezone}
                  </small>
                </span>
              </label>
            ))}
          </div>
        )}
        {a.sources.length > 0 && (
          <details className="shared-ai-sources">
            <summary>Sources ({a.sources.length})</summary>
            {a.sources.map((source, index) => (
              <a key={index} href={source.url}>
                {source.title}
              </a>
            ))}
          </details>
        )}
        {a.error && <Notice tone="error">{a.error}</Notice>}
      </div>
      <div className="shared-ai-bottom">
        {a.proposal &&
          a.proposal.habits.length +
            a.proposal.plans.length +
            a.proposal.meals.length >
            0 && (
            <div className="shared-ai-review">
              {a.applied ? (
                <span>
                  <Check size={15} />
                  Applied
                </span>
              ) : (
                <>
                  <span>{a.selected.size} selected</span>
                  <Button
                    disabled={
                      a.applying ||
                      a.busy ||
                      !a.selected.size ||
                      (a.conflicts.size > 0 && !a.retryPending)
                    }
                    onClick={() => void a.apply()}
                  >
                    {a.applying
                      ? "Applying…"
                      : a.retryPending
                        ? "Retry saving"
                        : "Apply changes"}
                  </Button>
                </>
              )}
            </div>
          )}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void a.ask();
          }}
        >
          <textarea
            aria-label="Message assistant"
            rows={3}
            placeholder="Ask about habits, meals or your calendar…"
            value={a.prompt}
            disabled={a.busy || a.applying || a.retryPending}
            onChange={(event) => a.setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                void a.ask();
              }
            }}
          />
          {a.busy ? (
            <button
              className="icon-button"
              type="button"
              aria-label="Stop assistant"
              onClick={a.cancel}
            >
              <Square size={16} />
            </button>
          ) : (
            <button
              className="shared-ai-send"
              aria-label="Send to assistant"
              disabled={!a.prompt.trim() || a.applying}
            >
              <ArrowUp size={18} />
            </button>
          )}
        </form>
      </div>
    </aside>
  );
}
