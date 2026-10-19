import { useEffect, useRef, useState } from "react";
import { Check, Inbox, ArrowRight } from "lucide-react";
import { useLocation } from "react-router-dom";
import { Notice } from "../../components/ui/notice";
import { useHomeActivity } from "./use-home-activity";
import { HomeReminderActions } from "./reminder-actions";
import type { HomeActivity } from "./types";

export function MissedActivity({
  timezone,
  onOpen,
}: {
  timezone: string;
  onOpen: (item: HomeActivity) => void;
}) {
  const [limit, setLimit] = useState(50);
  const { query, read } = useHomeActivity(limit);
  const items = query.data?.items ?? [];
  const unread = items.filter((item) => !item.read);
  const location = useLocation();
  const scrolledLocation = useRef<string | null>(null);
  useEffect(() => {
    if (
      location.hash === "#missed" &&
      query.data &&
      scrolledLocation.current !== location.key
    ) {
      document.getElementById("missed")?.scrollIntoView({ block: "start" });
      scrolledLocation.current = location.key;
    }
  }, [location.hash, location.key, query.data]);
  return (
    <section className="home-missed" id="missed" aria-label="Missed activity">
      <div className="home-section-heading">
        <h2>
          <Inbox size={16} />
          Still waiting
          {unread.length > 0 && (
            <span className="home-count">{unread.length}</span>
          )}
        </h2>
        {unread.length > 0 && (
          <button
            className="home-text-button"
            disabled={read.isPending}
            onClick={() => read.mutate(unread)}
          >
            Mark {query.data?.has_more ? "shown" : "all"} read
          </button>
        )}
      </div>
      <p className="home-section-caption">
        Read notifications stay here until you act on them.
      </p>
      {query.isPending && (
        <p className="home-empty" role="status">
          Loading missed activity…
        </p>
      )}
      {query.isError && (
        <Notice tone="error">
          {query.error.message}
          <button
            className="home-text-button"
            onClick={() => void query.refetch()}
          >
            Retry
          </button>
        </Notice>
      )}
      {!query.isPending && !query.isError && !items.length && (
        <p className="home-empty">You're all caught up.</p>
      )}
      {items.map((item) => (
        <article
          key={`${item.kind}-${item.id}`}
          className={`home-missed-item ${item.read ? "is-read" : ""}`}
        >
          <span
            className="home-unread-dot"
            aria-label={item.read ? "Read" : "Unread"}
          />
          <div className="home-missed-content">
            <button
              className="home-notification-title"
              onClick={() => {
                if (!item.read) read.mutate([item]);
                onOpen(item);
              }}
            >
              {item.title}
            </button>
            <span className="home-event-meta">
              {item.kind === "plan"
                ? "Planned activity"
                : `${item.workspace_name} / #${item.channel_name}`}
            </span>
            <time dateTime={item.due_at}>
              {new Date(item.due_at).toLocaleString([], {
                timeZone: timezone,
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
              })}
            </time>
            {item.kind === "reminder" ? (
              <HomeReminderActions id={item.id} revision={item.revision} />
            ) : (
              <button className="home-text-button" onClick={() => onOpen(item)}>
                {item.kind === "writing" ? "Write in channel" : "Choose activity"}
                <ArrowRight size={12} />
              </button>
            )}
          </div>
          {!item.read && (
            <button
              className="icon-button home-mark-read"
              aria-label={`Mark read: ${item.title}`}
              title="Mark read"
              disabled={read.isPending}
              onClick={() => read.mutate([item])}
            >
              <Check size={15} />
            </button>
          )}
        </article>
      ))}
      {query.data?.has_more &&
        (limit < 200 ? (
          <button
            className="home-text-button"
            onClick={() => setLimit(Math.min(200, limit + 50))}
          >
            Show more activity
          </button>
        ) : (
          <p className="home-empty">
            Showing the latest 200 notifications. Complete or snooze reminders
            to clear older items.
          </p>
        ))}
    </section>
  );
}
