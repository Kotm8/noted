import type { CSSProperties } from "react";
import { ChevronRight } from "lucide-react";
import type { Activity, TrackingPreferences } from "../../time-tracking/types";
import type { ScheduleBoard } from "../../schedule/types";
import {
  addDays,
  dayLabel,
  duration,
  minuteLabel,
  zonedParts,
} from "../../schedule/dates";
import { daySegment, occupiedMinutes, trackedSeconds } from "../ruler-data";

export function DayRuler({
  today,
  now,
  board,
  preferences,
  activities,
  onCalendar,
}: {
  today: string;
  now: number;
  board: ScheduleBoard;
  preferences: TrackingPreferences;
  activities: Activity[];
  onCalendar: (date?: string) => void;
}) {
  const { start_minute: start, end_minute: end, timezone } = preferences;
  const span = Math.max(1, end - start);
  const minute = zonedParts(now, timezone).minute;
  const ticks = Array.from(
    { length: Math.ceil(span / 120) },
    (_, index) => start + index * 120,
  ).concat(end);
  const segments = board.plans.flatMap((plan) => {
    const range = daySegment(plan.start_at, plan.end_at, today, timezone);
    return range ? [range] : [];
  });
  const from = Math.max(start, Math.min(end, minute));
  const free = Math.max(0, end - from - occupiedMinutes(segments, from, end));
  function position(first: number, last: number): CSSProperties {
    return {
      left: `${((Math.max(start, first) - start) / span) * 100}%`,
      width: `${(Math.max(0, Math.min(end, last) - Math.max(start, first)) / span) * 100}%`,
    };
  }
  return (
    <section
      className="home-day-ruler"
      aria-label="Three-day calendar overview"
    >
      <div className="home-ruler-board">
        <div className="home-ruler-axis">
          {ticks.map((tick) => (
            <span
              key={tick}
              style={{ left: `${((tick - start) / span) * 100}%` }}
            >
              {minuteLabel(tick)}
            </span>
          ))}
        </div>
        {[today, addDays(today, 1), addDays(today, 2)].map((day, index) => {
          const endings: number[] = [];
          const plans = board.plans
            .flatMap((plan) => {
              const range = daySegment(
                plan.start_at,
                plan.end_at,
                day,
                timezone,
              );
              return range && range.end > start && range.start < end
                ? [{ ...range, plan }]
                : [];
            })
            .sort((a, b) => a.start - b.start)
            .map((item) => {
              let row = endings.findIndex((value) => value <= item.start);
              if (row < 0) row = endings.length;
              endings[row] = item.end;
              return { ...item, row };
            });
          const height = Math.max(1, endings.length) * (index === 0 ? 48 : 30);
          return (
            <div
              className={`home-ruler-day ${index === 0 ? "today" : ""}`}
              key={day}
            >
              <button
                className="home-ruler-day-label"
                onClick={() => onCalendar(day)}
                aria-label={`Open calendar for ${day}`}
              >
                {index === 0 ? "Plan" : dayLabel(day, { weekday: "short" })}
              </button>
              <div
                className="home-ruler-lanes"
                style={{ "--home-plan-height": `${height}px` } as CSSProperties}
              >
                <div className="home-ruler-grid" aria-hidden="true">
                  {ticks.map((tick) => (
                    <i
                      key={tick}
                      style={{ left: `${((tick - start) / span) * 100}%` }}
                    />
                  ))}
                </div>
                <div className="home-ruler-plans">
                  {plans.map(({ plan, start: first, end: last, row }) => {
                    const activity = activities.find(
                      (item) => item.id === plan.activity_id,
                    );
                    return (
                      <button
                        key={`${plan.id}:${plan.occurrence_date}`}
                        className={`schedule-block planned-block home-ruler-plan ${plan.frequency !== "none" ? "recurring-block" : ""}`}
                        style={
                          {
                            ...position(first, last),
                            top: `${row * (index === 0 ? 48 : 30)}px`,
                            "--activity": activity?.color ?? "var(--accent)",
                          } as CSSProperties
                        }
                        title={`${plan.title} · ${minuteLabel(first)}–${minuteLabel(last)}`}
                        onClick={() => onCalendar(day)}
                      >
                        <span className="schedule-block-title">
                          <strong>{plan.title || activity?.name}</strong>
                        </span>
                        {index === 0 && (
                          <span className="schedule-block-time">
                            {minuteLabel(first)}–{minuteLabel(last)}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
                {index === 0 && (
                  <div
                    className="home-ruler-actual"
                    aria-label="Actual tracked time"
                  >
                    <span className="home-ruler-actual-label">Actual</span>
                    {board.sessions.map((session) => {
                      const range = daySegment(
                        session.started_at,
                        session.ended_at ?? new Date(now).toISOString(),
                        day,
                        timezone,
                      );
                      const activity = activities.find(
                        (item) => item.id === session.activity_id,
                      );
                      return range && range.end > start && range.start < end ? (
                        <button
                          key={session.id}
                          className="home-ruler-session"
                          style={
                            {
                              ...position(range.start, range.end),
                              "--activity": activity?.color ?? "var(--accent)",
                            } as CSSProperties
                          }
                          title={`${activity?.name ?? "Activity"} · ${minuteLabel(range.start)}–${minuteLabel(range.end)}`}
                          onClick={() => onCalendar(day)}
                        >
                          {activity?.name}
                        </button>
                      ) : null;
                    })}
                  </div>
                )}
                {index === 0 && minute >= start && minute <= end && (
                  <div
                    className="home-ruler-now"
                    style={{ left: `${((minute - start) / span) * 100}%` }}
                  >
                    <time>{minuteLabel(minute)}</time>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="home-day-totals" aria-label="Today's totals">
        <div>
          <span>Tracked</span>
          <strong>
            {duration(trackedSeconds(board.sessions, today, timezone, now))}
          </strong>
        </div>
        <div>
          <span>Planned</span>
          <strong>{duration(occupiedMinutes(segments) * 60)}</strong>
        </div>
        <div title="Time left in your schedule today without planned activities">
          <span>Left today</span>
          <strong>{duration(free * 60)}</strong>
        </div>
        <button
          className="home-text-button"
          aria-label="Full calendar"
          onClick={() => onCalendar(today)}
        >
          Calendar
          <ChevronRight size={13} />
        </button>
      </div>
    </section>
  );
}
