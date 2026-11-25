import { ChevronRight, Menu, Search, Sparkles } from "lucide-react";
import { useState } from "react";
import { useLocation } from "react-router-dom";
import { Modal } from "../../../components/ui/dialog";
import { Notice } from "../../../components/ui/notice";
import { useAiStatus } from "../../ai/queries";
import {
  dayLabel,
  duration,
  minuteLabel,
  wallTime,
  zonedParts,
} from "../../schedule/dates";
import { SessionEditor } from "../../schedule/components/session-editor";
import type { PlanOccurrence, ScheduleBoard } from "../../schedule/types";
import { TimeTracker } from "../../time-tracking/components/tracker";
import type { Activity, TimeSession } from "../../time-tracking/types";
import { trackedSeconds } from "../ruler-data";
import type { HomeActivity } from "../types";
import { HomeFood } from "./home-food";
import { HomeHabits } from "./home-habits";
import { HomeNeeds } from "./home-needs";
import { HomePins } from "./home-pins";
import "../phone-home.css";

export function PhoneHome({
  today,
  timezone,
  now,
  board,
  activities,
  error,
  retry,
  onNavigation,
  onSearch,
  onCalendar,
  onOpen,
  openHabits,
  openNutrition,
  openTracking,
}: {
  today: string;
  timezone: string;
  now: number;
  board?: ScheduleBoard;
  activities: Activity[];
  error: Error | null;
  retry: () => void;
  onNavigation: () => void;
  onSearch: () => void;
  onCalendar: (date?: string, plan?: string) => void;
  onOpen: (item: HomeActivity) => void;
  openHabits: () => void;
  openNutrition: () => void;
  openTracking: () => void;
}) {
  const [showSessions, setShowSessions] = useState(false);
  const route = useLocation();
  const chooseActivity = new URLSearchParams(route.search).get("track") === "1";
  const [editing, setEditing] = useState<TimeSession | null>(null);
  const ai = useAiStatus();
  const next = board?.plans.reduce<PlanOccurrence | undefined>(
    (first, plan) =>
      Date.parse(plan.start_at) > now &&
      (!first || plan.start_at < first.start_at)
        ? plan
        : first,
    undefined,
  );
  const nextStart = next && zonedParts(next.start_at, timezone);
  const dayStart = Date.parse(wallTime(today, 0, timezone));
  const dayEnd = Date.parse(wallTime(today, 1440, timezone));
  const sessions =
    board?.sessions
      .filter(
        (session) =>
          Date.parse(session.started_at) < dayEnd &&
          (session.ended_at === null ||
            Date.parse(session.ended_at) > dayStart),
      )
      .sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at)) ??
    [];
  return (
    <div className="home-b phone-home">
      <header className="channel-header phone-home-header">
        <button
          className="icon-button mobile-menu"
          aria-label="Open navigation"
          onClick={onNavigation}
        >
          <Menu size={21} />
        </button>
        <h1>
          {dayLabel(today, { weekday: "short", day: "numeric", month: "long" })}
        </h1>
        <button
          className="icon-button"
          aria-label="Open search"
          onClick={onSearch}
        >
          <Search size={20} />
        </button>
        {ai.data?.connected && (
          <button
            className="icon-button"
            aria-label="Ask AI"
            onClick={() =>
              window.dispatchEvent(new Event("noted:assistant-open"))
            }
          >
            <Sparkles size={19} />
          </button>
        )}
      </header>
      <div className="home-b-content phone-home-scroll">
        {error && (
          <Notice tone="error">
            {error.message}
            <button onClick={retry}>Retry</button>
          </Notice>
        )}
        <TimeTracker
          key={chooseActivity ? route.key : "tracker"}
          onSettings={openTracking}
          initiallyExpanded={chooseActivity}
          embedded
        />
        <div className="phone-home-progress">
          <HomeHabits compact today={today} onOpen={openHabits} />
          <HomeFood
            compact
            today={today}
            timezone={timezone}
            now={now}
            onOpen={openNutrition}
          />
        </div>
        <div className="phone-home-progress">
          <button
            className="phone-home-summary"
            disabled={!board}
            onClick={() => setShowSessions(true)}
          >
            <span>
              Tracked today <ChevronRight size={14} />
            </span>
            <strong>
              {board
                ? duration(trackedSeconds(sessions, today, timezone, now))
                : error
                  ? "Unavailable"
                  : "Loading…"}
            </strong>
          </button>
          <button
            className="phone-home-summary"
            onClick={() => onCalendar(nextStart?.date ?? today, next?.id)}
          >
            <span>
              Next up <ChevronRight size={14} />
            </span>
            <strong>
              {next?.title ?? (board ? "Nothing planned" : "Calendar")}
            </strong>
            {next && nextStart && (
              <time dateTime={next.start_at}>
                {nextStart.date !== today &&
                  `${dayLabel(nextStart.date, { weekday: "short" })} `}
                {minuteLabel(nextStart.minute)}
              </time>
            )}
          </button>
        </div>
        <HomeNeeds compact timezone={timezone} board={board} onOpen={onOpen} />
        <HomePins compact />
      </div>
      {showSessions && (
        <Modal
          open
          title="Tracked today"
          description={dayLabel(today, { month: "long", day: "numeric" })}
          onOpenChange={setShowSessions}
          className="phone-home-sheet"
        >
          {sessions.length ? (
            <ul className="phone-session-list">
              {sessions.map((session) => {
                const activity = activities.find(
                  (item) => item.id === session.activity_id,
                );
                const start = Math.max(
                  Date.parse(session.started_at),
                  dayStart,
                );
                const end = Math.min(
                  session.ended_at ? Date.parse(session.ended_at) : now,
                  dayEnd,
                );
                const name = activity?.name ?? "Activity";
                const range = `${minuteLabel(zonedParts(start, timezone).minute)} to ${session.ended_at ? (end === dayEnd ? "24:00" : minuteLabel(zonedParts(end, timezone).minute)) : "now"}`;
                return (
                  <li key={session.id}>
                    <button
                      disabled={!session.ended_at}
                      onClick={() => setEditing(session)}
                    >
                      <span>
                        <strong style={{ color: activity?.color }}>
                          {name}
                        </strong>
                        <small>{range}</small>
                      </span>
                      <time>{duration((end - start) / 1000)}</time>
                      {session.ended_at && <ChevronRight size={14} />}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p>No tracked time yet today.</p>
          )}
        </Modal>
      )}
      {editing && (
        <SessionEditor
          session={editing}
          activities={activities}
          timezone={timezone}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
