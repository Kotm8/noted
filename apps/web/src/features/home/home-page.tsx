import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  CalendarDays,
  ChevronDown,
  House,
  Menu,
  Search,
} from "lucide-react";
import { Notice } from "../../components/ui/notice";
import { scheduleApi } from "../schedule/api";
import {
  addDays,
  dayLabel,
  duration,
  wallTime,
  zonedParts,
} from "../schedule/dates";
import { useTracking } from "../time-tracking/use-tracking";
import { MissedActivity } from "./missed-activity";
import { HomeReminderActions } from "./reminder-actions";
import type { HomeActivity } from "./types";

interface HomePageProps {
  onNavigation: () => void;
  onCalendar: () => void;
  onSearch: () => void;
  onActivity: () => void;
  onOpen: (item: HomeActivity) => void;
}

export function HomePage({
  onNavigation,
  onCalendar,
  onSearch,
  onActivity,
  onOpen,
}: HomePageProps) {
  const tracking = useTracking();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(timer);
  }, []);
  const timezone =
    tracking.tracker.data?.preferences.timezone ??
    Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = zonedParts(now, timezone).date;
  const start = wallTime(today, 0, timezone);
  const end = wallTime(addDays(today, 1), 0, timezone);
  const board = useQuery({
    queryKey: ["schedule", start, end],
    queryFn: () => scheduleApi.board(start, end),
    refetchInterval: 15000,
    enabled: Boolean(tracking.tracker.data),
  });
  const active = tracking.tracker.data?.active;
  const activity = tracking.activities.data?.find(
    (item) => item.id === active?.activity_id,
  );
  const plans = (board.data?.plans ?? []).filter(
    (plan) => Date.parse(plan.end_at) > now,
  );
  const reminders = (board.data?.reminders ?? []).filter(
    (reminder) => Date.parse(reminder.due_at) > now,
  );
  const agenda = [
    ...plans.map((plan) => ({
      key: `plan-${plan.id}-${plan.occurrence_date}`,
      time: plan.start_at,
      plan,
    })),
    ...reminders.map((reminder) => ({
      key: `reminder-${reminder.message_id}`,
      time: reminder.due_at,
      reminder,
    })),
  ].sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  const clock = (value: string) =>
    new Date(value).toLocaleTimeString([], {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  const failure = tracking.tracker.error ?? board.error;
  return (
    <>
      <header className="channel-header home-header">
        <button
          className="icon-button mobile-menu"
          aria-label="Open navigation"
          onClick={onNavigation}
        >
          <Menu size={20} />
        </button>
        <div className="channel-heading">
          <House size={17} />
          <h1>Home</h1>
        </div>
        <button
          className="icon-button"
          aria-label="Open search"
          onClick={onSearch}
        >
          <Search size={18} />
        </button>
      </header>
      <div className="home-scroll">
        <div className="home-daybook">
          <div className="home-greeting">
            <div>
              <span className="home-eyebrow">YOUR DAY</span>
              <h1>{dayLabel(today, { weekday: "long" })}, at your pace.</h1>
              <p>A little structure, with space for the rest.</p>
            </div>
            <div className="home-date">
              <span>
                {dayLabel(today, { month: "long" })}
                <br />
                {today.slice(0, 4)}
              </span>
              <strong>{Number(today.slice(-2))}</strong>
            </div>
          </div>
          <div className="home-day-layout">
            <section className="home-agenda" aria-label="Today's agenda">
              <div className="home-section-heading">
                <h2>Today's rhythm</h2>
                <button className="home-text-button" onClick={onCalendar}>
                  Full calendar
                  <ArrowRight size={14} />
                </button>
              </div>
              {failure && (
                <Notice tone="error">
                  {failure.message}
                  <button
                    className="home-text-button"
                    onClick={() => {
                      void tracking.tracker.refetch();
                      void board.refetch();
                    }}
                  >
                    Retry
                  </button>
                </Notice>
              )}
              {(tracking.tracker.isPending || board.isPending) && !failure && (
                <p className="home-empty" role="status">
                  Loading your day…
                </p>
              )}
              <div className="home-timeline">
                {active && activity && (
                  <article className="home-timeline-event">
                    <time className="home-hour">
                      {clock(active.started_at)}
                    </time>
                    <div className="home-timeline-body home-current">
                      <span className="home-event-kicker">
                        <i />
                        IN PROGRESS
                      </span>
                      <h3>{activity.name}</h3>
                      <p>
                        Tracking for{" "}
                        {duration(
                          (tracking.tracker.data?.elapsed_seconds ?? 0) +
                            Math.max(
                              0,
                              Math.floor(
                                (now - tracking.tracker.dataUpdatedAt) / 1000,
                              ),
                            ),
                        )}
                        .
                      </p>
                      <button className="home-text-button" onClick={onActivity}>
                        <ChevronDown size={14} />
                        Change activity
                      </button>
                    </div>
                  </article>
                )}
                {agenda.map((item) => (
                  <article className="home-timeline-event" key={item.key}>
                    <time className="home-hour" dateTime={item.time}>
                      {clock(item.time)}
                    </time>
                    <div className="home-timeline-body">
                      {"plan" in item && item.plan ? (
                        <>
                          <span className="home-event-kicker">
                            {item.plan.frequency === "none"
                              ? "PLANNED"
                              : "RECURRING"}{" "}
                            · {clock(item.plan.start_at)} TO{" "}
                            {clock(item.plan.end_at)}
                          </span>
                          <h3>{item.plan.title}</h3>
                          <p>
                            {
                              tracking.activities.data?.find(
                                (activity) =>
                                  activity.id === item.plan.activity_id,
                              )?.name
                            }
                          </p>
                          <button
                            className="home-text-button"
                            onClick={onCalendar}
                          >
                            Open calendar
                            <ArrowRight size={13} />
                          </button>
                        </>
                      ) : "reminder" in item && item.reminder ? (
                        <>
                          <span className="home-event-kicker">
                            {item.reminder.workspace_name} / #
                            {item.reminder.channel_name}
                          </span>
                          <h3>
                            {item.reminder.content || "Attachment reminder"}
                          </h3>
                          <button
                            className="home-text-button"
                            onClick={() =>
                              onOpen({
                                kind: "reminder",
                                id: item.reminder.message_id,
                                revision: item.reminder.revision ?? 1,
                                title: item.reminder.content,
                                due_at: item.reminder.due_at,
                                read: true,
                                workspace_id: item.reminder.workspace_id,
                                workspace_name: item.reminder.workspace_name,
                                channel_id: item.reminder.channel_id,
                                channel_name: item.reminder.channel_name,
                              })
                            }
                          >
                            Open note
                            <ArrowRight size={13} />
                          </button>
                          <HomeReminderActions
                            id={item.reminder.message_id}
                            revision={item.reminder.revision ?? 1}
                          />
                        </>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
              {board.data && !agenda.length && !active && (
                <div className="home-free-day">
                  <CalendarDays size={24} />
                  <h3>A little room in your day.</h3>
                  <p>No more plans or reminders for today.</p>
                  <button className="home-text-button" onClick={onCalendar}>
                    Plan something
                    <ArrowRight size={14} />
                  </button>
                </div>
              )}
              <span className="home-timezone">
                Times in {timezone.replaceAll("_", " ")}
              </span>
            </section>
            <aside className="home-day-side">
              <MissedActivity timezone={timezone} onOpen={onOpen} />
              <button className="home-plan-button" onClick={onCalendar}>
                <CalendarDays size={15} />
                Plan something
              </button>
            </aside>
          </div>
        </div>
      </div>
    </>
  );
}
