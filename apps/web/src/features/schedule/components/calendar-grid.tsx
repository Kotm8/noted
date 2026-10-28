import { Flag, Info, Play, Repeat2 } from "lucide-react";
import type { CSSProperties } from "react";
import {
  ActivityIcon,
  ActivityGlyphIcon,
} from "../../time-tracking/components/activity-icon";
import type {
  Activity,
  TimeSession,
  TrackingPreferences,
} from "../../time-tracking/types";
import {
  addDays,
  dateRangeLabel,
  dayLabel,
  duration,
  minuteLabel,
  wallTime,
  zonedParts,
} from "../dates";
import type { PlanOccurrence, ReminderFlag, ScheduleBoard } from "../types";

import { ReminderFlags } from "./reminder-flags";

function position(
  start: number,
  end: number,
  preferences: TrackingPreferences,
): CSSProperties {
  const first = Math.max(start, preferences.start_minute);
  const last = Math.min(end, preferences.end_minute);
  const span = preferences.end_minute - preferences.start_minute;
  return {
    left: `${((first - preferences.start_minute) / span) * 100}%`,
    width: `${(Math.max(0, last - first) / span) * 100}%`,
  };
}

function segments(start: string, end: string, date: string, timezone: string) {
  const first = zonedParts(start, timezone);
  const last = zonedParts(end, timezone);
  if (
    first.date > date ||
    last.date < date ||
    (last.date === date && last.minute === 0)
  )
    return null;
  return {
    start: first.date < date ? 0 : first.minute,
    end: last.date > date ? 1440 : last.minute,
  };
}

export interface GridProps {
  days: string[];
  /** Days whose week is still loading, so empty rows aren't shown as empty. */
  loading?: Set<string>;
  selected: string;
  mode: "week" | "day";
  activities: Activity[];
  data: ScheduleBoard;
  preferences: TrackingPreferences;
  now: number;
  onPlan: (plan: PlanOccurrence) => void;
  onSession: (session: TimeSession) => void;
  onReminder: (flag: ReminderFlag) => void;
  onDay: (day: string) => void;
  onStart: (id: string) => void;
}

export function CalendarGrid(props: GridProps) {
  const { preferences, days, mode, activities } = props;
  const start = preferences.start_minute;
  const span = preferences.end_minute - start;
  const ticks = Array.from({ length: Math.ceil(span / 120) + 1 }, (_, index) =>
    Math.min(start + index * 120, preferences.end_minute),
  );
  const axis = (
    <div className="schedule-time-axis">
      {ticks.map((minute) => (
        <span
          key={minute}
          style={{ left: `${((minute - start) / span) * 100}%` }}
        >
          {minuteLabel(minute)}
        </span>
      ))}
    </div>
  );
  return (
    <div
      className={`schedule-grid ${mode === "day" ? "schedule-activity-grid" : ""}`}
      style={{ "--schedule-hours": span / 60 } as CSSProperties}
    >
      <div className="schedule-axis-row">
        <span>{mode === "day" ? "ACTIVITY" : preferences.timezone}</span>
        {axis}
        {mode === "day" && <span>TRACKED</span>}
      </div>
      {mode === "day" && props.data.reminders.length > 0 && (
        <div className="schedule-day-reminders">
          <span>
            <Flag size={13} />
            Reminders
          </span>
          <div>
            <ReminderFlags
              reminders={props.data.reminders}
              date={days[0]}
              preferences={preferences}
              onSelect={props.onReminder}
            />
          </div>
          <span />
        </div>
      )}
      {mode === "week"
        ? days.flatMap((date, index) => [
            ...(index % 7
              ? []
              : [
                  <div className="schedule-week-divider" key={`week-${date}`}>
                    {dateRangeLabel(date, addDays(date, 6))}
                  </div>,
                ]),
            <div
              className={`schedule-week-row${date === props.selected ? " selected-day" : ""}${props.loading?.has(date) ? " loading" : ""}`}
              key={date}
              data-week={index % 7 ? undefined : date}
              aria-busy={props.loading?.has(date) || undefined}
            >
              <button
                className="schedule-day-label"
                onClick={() => props.onDay(date)}
                title={`Open ${dayLabel(date)} in Day view`}
              >
                <span>{dayLabel(date, { weekday: "short" })}</span>
                <strong>{Number(date.slice(8))}</strong>
                <small>Plan</small>
                <small>Actual</small>
              </button>
              <CalendarTracks {...props} date={date} />
            </div>,
          ])
        : activities
            .filter(
              (item) =>
                !item.archived ||
                props.data.plans.some((plan) => plan.activity_id === item.id),
            )
            .map((item) => {
              const first = Date.parse(
                wallTime(days[0], 0, preferences.timezone),
              );
              const end = Date.parse(
                wallTime(days[0], 1440, preferences.timezone),
              );
              const seconds = props.data.sessions
                .filter((session) => session.activity_id === item.id)
                .reduce(
                  (sum, session) =>
                    sum +
                    Math.max(
                      0,
                      (Math.min(
                        Date.parse(
                          session.ended_at ?? new Date(props.now).toISOString(),
                        ),
                        end,
                      ) -
                        Math.max(Date.parse(session.started_at), first)) /
                        1000,
                    ),
                  0,
                );
              return (
                <div className="schedule-activity-row" key={item.id}>
                  <div className="schedule-lane-label">
                    <ActivityIcon activity={item} />
                    <span>
                      {item.name}
                      <small>Plan above · actual below</small>
                    </span>
                    <button
                      className="icon-button"
                      aria-label={`Start ${item.name}`}
                      disabled={item.archived}
                      onClick={() => props.onStart(item.id)}
                    >
                      <Play size={13} />
                    </button>
                  </div>
                  <CalendarTracks
                    {...props}
                    date={days[0]}
                    activityId={item.id}
                  />
                  <span className="schedule-lane-total">
                    {duration(seconds)}
                  </span>
                </div>
              );
            })}
      {!activities.length && mode === "day" && (
        <p className="schedule-empty">
          <Info size={16} />
          Add activities in Settings to plan your day.
        </p>
      )}
    </div>
  );
}

function CalendarTracks(
  props: GridProps & { date: string; activityId?: string },
) {
  const { date, activityId, data, preferences, activities, now } = props;
  const getActivity = (id: string) => activities.find((item) => item.id === id);
  const planSegments = data.plans.flatMap((plan) => {
    const segment = segments(
      plan.start_at,
      plan.end_at,
      date,
      preferences.timezone,
    );
    return segment && (!activityId || activityId === plan.activity_id)
      ? [{ plan, ...segment }]
      : [];
  });
  const endings: number[] = [];
  const plans = planSegments
    .sort((a, b) => a.start - b.start)
    .map((item) => {
      let row = endings.findIndex((end) => end <= item.start);
      if (row < 0) row = endings.length;
      endings[row] = item.end;
      return { ...item, row };
    });
  const visible = (start: number, end: number) =>
    end > preferences.start_minute && start < preferences.end_minute;
  const sessionSegments = data.sessions.flatMap((session) => {
    const segment = segments(
      session.started_at,
      session.ended_at ?? new Date(now).toISOString(),
      date,
      preferences.timezone,
    );
    return segment && (!activityId || activityId === session.activity_id)
      ? [{ session, ...segment }]
      : [];
  });
  const current = zonedParts(now, preferences.timezone);
  return (
    <div className="schedule-dual-track">
      <div
        className="schedule-planned-line"
        data-draw
        data-date={date}
        data-activity={activityId}
        role="group"
        tabIndex={0}
        aria-label={`Plan ${activityId ? getActivity(activityId)?.name : dayLabel(date)}. Click or drag to create a plan.`}
        style={{ "--plan-rows": Math.max(1, endings.length) } as CSSProperties}
      >
        {plans
          .filter((item) => visible(item.start, item.end))
          .map(({ plan, start, end, row }) => {
            const activity = getActivity(plan.activity_id);
            const dragDisabled =
              zonedParts(plan.start_at, preferences.timezone).date !== date ||
              zonedParts(plan.end_at, preferences.timezone).date !== date ||
              start < preferences.start_minute ||
              end > preferences.end_minute;
            return (
              <button
                type="button"
                key={`${plan.id}-${plan.occurrence_date}`}
                className={`schedule-block planned-block ${plan.frequency !== "none" ? "recurring-block" : ""}`}
                style={
                  {
                    ...position(start, end, preferences),
                    "--activity": activity?.color ?? "var(--accent)",
                    top: row * 54,
                  } as CSSProperties
                }
                data-plan={`${plan.id}~${plan.occurrence_date}`}
                data-drag-disabled={dragDisabled || undefined}
                data-start={start}
                data-end={end}
                data-date={date}
                data-activity={plan.activity_id}
                aria-label={`Edit plan: ${plan.title}, ${minuteLabel(start)} to ${minuteLabel(end)}`}
                title={`${plan.title} · ${minuteLabel(start)}–${minuteLabel(end)}${plan.frequency !== "none" ? " · Repeats" : ""}${plan.is_override ? " · Edited occurrence" : ""}`}
                onClick={() => props.onPlan(plan)}
              >
                {!dragDisabled && (
                  <span
                    className="schedule-resize resize-start"
                    data-resize="start"
                    aria-hidden="true"
                  />
                )}
                <span className="schedule-block-title">
                  {plan.frequency !== "none" ? (
                    <Repeat2 size={13} />
                  ) : (
                    <ActivityGlyphIcon name={activity?.icon ?? "Activity"} />
                  )}
                  <strong>{plan.title}</strong>
                  {plan.is_override && <i className="schedule-exception-dot" />}
                </span>
                <span className="schedule-block-time">
                  {minuteLabel(start)}–{minuteLabel(end)}
                  {plan.frequency !== "none" ? " · Repeats" : ""}
                </span>
                {!dragDisabled && (
                  <span
                    className="schedule-resize resize-end"
                    data-resize="end"
                    aria-hidden="true"
                  />
                )}
              </button>
            );
          })}
      </div>
      <div className="schedule-actual-line">
        {sessionSegments
          .filter((item) => visible(item.start, item.end))
          .map(({ session, start, end }) => (
            <button
              key={session.id}
              className={`schedule-actual-block ${!session.ended_at ? "live-block" : ""}`}
              style={
                {
                  ...position(start, end, preferences),
                  "--activity":
                    getActivity(session.activity_id)?.color ?? "var(--accent)",
                } as CSSProperties
              }
              onClick={() => {
                if (session.ended_at) props.onSession(session);
              }}
              aria-label={`${session.ended_at ? "Edit session" : "Currently tracking"}: ${getActivity(session.activity_id)?.name}, ${minuteLabel(start)} to ${minuteLabel(end)}`}
              title={`${getActivity(session.activity_id)?.name} · ${minuteLabel(start)}–${minuteLabel(end)}`}
            >
              <span>{getActivity(session.activity_id)?.name}</span>
            </button>
          ))}
        {!sessionSegments.length && (
          <span className="schedule-no-actual">No tracked time</span>
        )}
      </div>
      {props.mode === "week" && (
        <ReminderFlags
          reminders={data.reminders}
          date={date}
          preferences={preferences}
          onSelect={props.onReminder}
        />
      )}
      {current.date === date && visible(current.minute, current.minute + 1) && (
        <span
          className="schedule-now"
          style={{
            left: `${((current.minute - preferences.start_minute) / (preferences.end_minute - preferences.start_minute)) * 100}%`,
          }}
        >
          <span>{minuteLabel(current.minute)}</span>
        </span>
      )}
    </div>
  );
}
