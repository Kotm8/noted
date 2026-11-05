import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  CalendarDays,
  ChevronDown,
  RotateCcw,
  Sparkles,
  Settings,
  Square,
  X,
} from "lucide-react";
import { Button } from "../../../components/ui/button";
import { DatePicker } from "../../../components/ui/date-picker";
import { Notice } from "../../../components/ui/notice";
import { useAndroidBackLayer } from "../../../lib/android-navigation";
import { TimeField } from "../../schedule/components/time-field";
import {
  addDays,
  dayLabel,
  duration,
  minuteLabel,
  weekDays,
  zonedParts,
} from "../../schedule/dates";
import type { Activity } from "../../time-tracking/types";
import { ActivityIcon } from "../../time-tracking/components/activity-icon";
import { AiSources, AiThinking } from "../components/ai-feedback";
import type { CalendarProposal, PreviewPlan } from "./types";
import type { CalendarPlannerState } from "./use-calendar-planner";

export function CalendarPlanner({
  planner,
  activities,
  onEdit,
  onDay,
}: {
  planner: CalendarPlannerState;
  activities: Activity[];
  onEdit: (plan: PreviewPlan, anchor: DOMRect) => void;
  onDay: (date: string) => void;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const [expandedFor, setExpandedFor] = useState<CalendarProposal | null>(null);
  const proposal = planner.run.result?.proposal;
  useAndroidBackLayer(planner.open, () => planner.setOpen(false));
  useEffect(() => {
    if (planner.open && window.matchMedia("(min-width: 901px)").matches)
      input.current?.focus({ preventScroll: true });
  }, [planner.open]);
  useEffect(() => {
    if (proposal && window.matchMedia("(max-width: 900px)").matches)
      input.current?.blur();
  }, [proposal]);
  if (!planner.open) return null;
  const { scope } = planner;
  const showScope = !proposal || expandedFor === proposal;
  const selectedDuration = planner.selected.reduce(
    (sum, item) => sum + item.end_minute - item.start_minute,
    0,
  );
  const canApply =
    planner.selected.length > 0 &&
    planner.boardReady &&
    planner.online &&
    !planner.busy &&
    (planner.retryPending ||
      !planner.selected.some((item) => planner.conflicts.has(item.id)));
  const today = zonedParts(Date.now(), scope.timezone).date;
  function preset(start: string, end = start) {
    planner.changeScope({ ...scope, start, end });
    onDay(start);
  }
  return (
    <aside
      className="calendar-ai-panel"
      aria-label="Calendar planner"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented) {
          event.stopPropagation();
          planner.setOpen(false);
        }
      }}
    >
      <header className="calendar-ai-heading">
        <div>
          <Sparkles size={16} />
          <strong>Plan with AI</strong>
        </div>
        <button
          type="button"
          className="icon-button calendar-ai-settings"
          aria-label="Calendar AI preferences"
          onClick={() => window.dispatchEvent(new Event("noted:ai-settings"))}
        >
          <Settings size={15} />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Hide calendar planner"
          onClick={() => planner.setOpen(false)}
        >
          <ChevronDown size={17} />
        </button>
      </header>
      <div className="calendar-ai-scroll">
        {proposal && (
          <button
            type="button"
            className="calendar-ai-scope-summary"
            aria-expanded={showScope}
            onClick={() => setExpandedFor(showScope ? null : proposal)}
          >
            <CalendarDays size={15} />
            <span>
              <strong>
                {dayLabel(scope.start)}
                {scope.end !== scope.start
                  ? ` through ${dayLabel(scope.end)}`
                  : ""}
              </strong>
              <small>
                {minuteLabel(scope.start_minute)}–
                {minuteLabel(scope.end_minute)} · {scope.timezone}
              </small>
            </span>
            <ChevronDown size={14} />
          </button>
        )}
        {showScope && (
          <fieldset className="calendar-ai-scope" disabled={planner.busy}>
            <legend>Make room for what matters</legend>
            <div className="calendar-ai-presets">
              <button type="button" onClick={() => preset(today)}>
                Today
              </button>
              <button type="button" onClick={() => preset(addDays(today, 1))}>
                Tomorrow
              </button>
              <button
                type="button"
                onClick={() => preset(today, addDays(weekDays(today)[0], 6))}
              >
                This week
              </button>
            </div>
            <div className="calendar-ai-dates">
              <label>
                <span>From</span>
                <DatePicker
                  label="Planning from date"
                  value={scope.start}
                  onChange={(start) => {
                    planner.changeScope({
                      ...scope,
                      start,
                      end: scope.end < start ? start : scope.end,
                    });
                    onDay(start);
                  }}
                />
              </label>
              <label>
                <span>Through</span>
                <DatePicker
                  label="Planning through date"
                  value={scope.end}
                  onChange={(end) => planner.changeScope({ ...scope, end })}
                />
              </label>
            </div>
            <div className="calendar-ai-hours">
              <TimeField
                label="Planning start"
                value={scope.start_minute}
                onChange={(start_minute) =>
                  planner.changeScope({ ...scope, start_minute })
                }
              />
              <span>to</span>
              <TimeField
                label="Planning end"
                end
                value={scope.end_minute}
                onChange={(end_minute) =>
                  planner.changeScope({ ...scope, end_minute })
                }
              />
            </div>
            <small>Up to 31 days · {scope.timezone}</small>
          </fieldset>
        )}
        {!planner.validScope && (
          <Notice tone="error">
            Choose up to 31 days and an end time after the start.
          </Notice>
        )}
        {!planner.online && (
          <Notice>
            Connect to the internet to plan or add suggestions. Your draft stays
            here.
          </Notice>
        )}
        {!activities.some((item) => !item.archived) && (
          <Notice>Add activities in Time tracking settings first.</Notice>
        )}
        {planner.lastPrompt && (
          <p className="calendar-ai-question">{planner.lastPrompt}</p>
        )}
        {planner.run.result && <AiThinking result={planner.run.result} />}
        {planner.run.result && (
          <AiSources sources={planner.run.result.sources} />
        )}
        {planner.run.result?.proposal && !planner.run.busy && (
          <p className="calendar-ai-explanation">
            {planner.run.result.proposal.explanation}
          </p>
        )}
        {planner.error && <Notice tone="error">{planner.error}</Notice>}
        {planner.retryPending && (
          <Notice>
            The save could not be confirmed. Retry saving to check it without
            adding duplicates.
          </Notice>
        )}
        {planner.proposals.length > 0 && (
          <>
            <div className="calendar-ai-list-heading">
              <span>Suggested plans</span>
              <small>Review before adding</small>
            </div>
            <ol className="calendar-ai-proposals">
              {planner.proposals.map((plan) => {
                const activity = activities.find(
                  (item) => item.id === plan.activity_id,
                );
                const conflict = planner.conflicts.get(plan.id);
                return (
                  <li
                    key={plan.id}
                    className={`${plan.selected ? "" : "excluded"}${conflict && plan.selected ? " has-conflict" : ""}`}
                  >
                    <div className="calendar-ai-proposal-row">
                      <input
                        type="checkbox"
                        checked={plan.selected}
                        disabled={planner.busy}
                        aria-label={`Include ${plan.title}`}
                        onChange={(event) =>
                          planner.change(plan.id, {
                            selected: event.target.checked,
                          })
                        }
                      />
                      <button
                        type="button"
                        className="calendar-ai-proposal-edit"
                        disabled={planner.busy}
                        onClick={(event) => {
                          onDay(plan.date);
                          onEdit(
                            plan,
                            event.currentTarget.getBoundingClientRect(),
                          );
                        }}
                      >
                        {activity && <ActivityIcon activity={activity} />}
                        <span>
                          <strong>{plan.title}</strong>
                          <small>
                            {dayLabel(plan.date, {
                              weekday: "short",
                              day: "numeric",
                              month: "short",
                            })}{" "}
                            · {minuteLabel(plan.start_minute)}–
                            {minuteLabel(plan.end_minute)}
                          </small>
                        </span>
                      </button>
                    </div>
                    {conflict && plan.selected && (
                      <div className="calendar-ai-conflict">
                        <span>{conflict}</span>
                        <button
                          type="button"
                          disabled={planner.busy}
                          onClick={() => planner.fit(plan.id)}
                        >
                          Find a gap
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          </>
        )}
        {!planner.run.result && !planner.proposals.length && (
          <div className="calendar-ai-empty">
            <CalendarDays size={25} />
            <strong>A little space for your day</strong>
            <p>
              Ask for a plan using your activities. Existing plans stay in
              place.
            </p>
            <button
              type="button"
              onClick={() => {
                planner.setPrompt(
                  "Help me plan the rest of my day, with breaks between activities.",
                );
                input.current?.focus();
              }}
            >
              Plan the rest of my day <ArrowUp size={13} />
            </button>
          </div>
        )}
        {planner.run.result?.stage === "applied" && (
          <p className="calendar-ai-explanation">
            Added to your calendar. You can undo from the confirmation or with
            Ctrl+Z.
          </p>
        )}
      </div>
      <div className="calendar-ai-bottom">
        {planner.proposals.length > 0 && (
          <div className="calendar-ai-review">
            <span>
              <strong>{planner.selected.length} selected</strong>
              <small>{duration(selectedDuration * 60)}</small>
            </span>
            <Button
              variant="ghost"
              size="small"
              disabled={planner.busy}
              onClick={planner.discard}
            >
              Cancel
            </Button>
            <Button
              size="small"
              disabled={!canApply}
              onClick={() => void planner.apply()}
            >
              {planner.applying
                ? "Adding…"
                : planner.retryPending
                  ? "Retry saving"
                  : `Add ${planner.selected.length} ${planner.selected.length === 1 ? "plan" : "plans"}`}
            </Button>
          </div>
        )}
        <form
          className="calendar-ai-compose"
          onSubmit={(event) => {
            event.preventDefault();
            void planner.ask();
          }}
        >
          <textarea
            ref={input}
            aria-label="Ask calendar AI"
            value={planner.prompt}
            disabled={planner.busy}
            maxLength={4000}
            rows={3}
            placeholder={
              planner.proposals.length
                ? "Make sessions shorter, add a break…"
                : "Plan my day from my journal, or tell me what you want to make time for…"
            }
            onChange={(event) => planner.setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                void planner.ask();
              }
            }}
          />
          <div>
            <small>Only your calendar and activities</small>
            {planner.run.busy ? (
              <button
                type="button"
                className="icon-button"
                aria-label="Stop calendar AI"
                onClick={() => planner.run.cancel(false)}
              >
                <Square size={15} />
              </button>
            ) : (
              <button
                type="submit"
                className="calendar-ai-send"
                aria-label="Ask calendar AI"
                disabled={
                  !planner.prompt.trim() ||
                  !planner.validScope ||
                  !planner.online ||
                  planner.busy ||
                  !activities.some((item) => !item.archived)
                }
              >
                <ArrowUp size={18} />
              </button>
            )}
          </div>
        </form>
        <div className="calendar-ai-footnote">
          <button
            type="button"
            disabled={planner.busy}
            onClick={planner.discard}
          >
            <X size={12} />
            Discard
          </button>
          <button
            type="button"
            disabled={planner.busy || !planner.lastPrompt}
            onClick={() => void planner.ask(planner.lastPrompt)}
          >
            <RotateCcw size={12} />
            Try again
          </button>
        </div>
      </div>
    </aside>
  );
}
