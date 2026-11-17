import { ComicHalftone } from "../../../components/ui/comic-halftone";
import { useEffect, useState } from "react";
import { Menu, Pause, Play, Search, Square, ChevronDown } from "lucide-react";
import { AssistantButton } from "../../ai/assistant/assistant-button";
import { dayLabel } from "../../schedule/dates";
import type { useTracking } from "../../time-tracking/use-tracking";

export function HomeHeader({
  today,
  tracking,
  onNavigation,
  onSearch,
  onActivity,
}: {
  today: string;
  tracking: ReturnType<typeof useTracking>;
  onNavigation: () => void;
  onSearch: () => void;
  onActivity: () => void;
}) {
  const [now, setNow] = useState(Date.now);
  const data = tracking.tracker.data;
  const activeId = data?.active?.id;
  useEffect(() => {
    if (!activeId) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [activeId]);
  const activity = tracking.activities.data?.find(
    (item) =>
      item.id === (data?.active?.activity_id ?? data?.paused_activity_id),
  );
  const elapsed =
    (data?.elapsed_seconds ?? 0) +
    (data?.active
      ? Math.max(0, Math.floor((now - tracking.tracker.dataUpdatedAt) / 1000))
      : 0);
  const time = [
    Math.floor(elapsed / 3600),
    Math.floor(elapsed / 60) % 60,
    elapsed % 60,
  ]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
  return (
    <header className="channel-header home-b-header">
      <ComicHalftone />
      <button
        className="icon-button mobile-menu"
        aria-label="Open navigation"
        onClick={onNavigation}
      >
        <Menu size={20} />
      </button>
      <h1 aria-label="Home">
        {dayLabel(today, { weekday: "long", day: "numeric", month: "long" })}
      </h1>
      <div className="home-header-tracker">
        {activity && (
          <>
            <span
              className="home-tracker-activity"
              style={{ color: activity.color }}
            >
              <i style={{ background: activity.color }} />
              {activity.name}
            </span>
            <time
              className="home-header-elapsed"
              aria-label={
                data?.active ? "Elapsed tracking time" : "Paused tracking time"
              }
            >
              {time}
            </time>
            <button
              className="home-small-button"
              aria-label={data?.active ? "Pause activity" : "Resume activity"}
              title={data?.active ? "Pause" : "Resume"}
              disabled={tracking.action.isPending}
              onClick={() =>
                tracking.action.mutate({
                  action: data?.active ? "pause" : "resume",
                })
              }
            >
              {data?.active ? <Pause size={14} /> : <Play size={14} />}
            </button>
            <button
              className="home-small-button"
              aria-label="Stop activity"
              title="Stop"
              disabled={tracking.action.isPending}
              onClick={() => tracking.action.mutate({ action: "stop" })}
            >
              <Square size={13} />
            </button>
          </>
        )}
        <button className="home-small-button" onClick={onActivity}>
          {activity ? "Switch" : "Start tracking"}
          <ChevronDown size={13} />
        </button>
      </div>
      <div className="header-actions">
        <button
          className="icon-button"
          aria-label="Open search"
          onClick={onSearch}
        >
          <Search size={18} />
        </button>
        <AssistantButton />
      </div>
    </header>
  );
}
