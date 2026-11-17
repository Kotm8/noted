import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Notice } from "../../components/ui/notice";
import { liveInterval } from "../../lib/live";
import { useTracking } from "../time-tracking/use-tracking";
import { scheduleApi } from "../schedule/api";
import { addDays, wallTime, zonedParts } from "../schedule/dates";
import { useWorkspaceShell } from "../workspaces/shell-context";
import { HomeHeader } from "./components/home-header";
import { DayRuler } from "./components/day-ruler";
import { HomeNeeds } from "./components/home-needs";
import { HomeHabits } from "./components/home-habits";
import { HomeFood } from "./components/home-food";
import { HomePins } from "./components/home-pins";
import type { HomeActivity } from "./types";
import "./home-b.css";

interface HomePageProps {
  onNavigation: () => void;
  onCalendar: (date?: string) => void;
  onSearch: () => void;
  onActivity: () => void;
  onOpen: (item: HomeActivity) => void;
}

export function HomePage(props: HomePageProps) {
  const tracking = useTracking();
  const shell = useWorkspaceShell();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(interval);
  }, []);
  const preferences = tracking.tracker.data?.preferences;
  const timezone =
    preferences?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = zonedParts(now, timezone).date;
  const start = wallTime(today, 0, timezone);
  const end = wallTime(addDays(today, 3), 0, timezone);
  const board = useQuery({
    queryKey: ["schedule", start, end],
    queryFn: () => scheduleApi.board(start, end),
    refetchInterval: () => liveInterval(15000),
    enabled: Boolean(preferences),
  });
  const error = tracking.tracker.error ?? board.error;
  return (
    <div className="home-b">
      <HomeHeader
        today={today}
        tracking={tracking}
        onNavigation={props.onNavigation}
        onSearch={props.onSearch}
        onActivity={props.onActivity}
      />
      <div className="home-scroll home-b-content">
        {error && (
          <Notice tone="error">
            {error.message}
            <button
              onClick={() => {
                void tracking.tracker.refetch();
                void board.refetch();
              }}
            >
              Retry
            </button>
          </Notice>
        )}
        {board.data && preferences ? (
          <DayRuler
            today={today}
            now={now}
            board={board.data}
            preferences={preferences}
            activities={tracking.activities.data ?? []}
            onCalendar={props.onCalendar}
          />
        ) : (
          !error && (
            <div className="home-ruler-loading" role="status">
              Loading your day...
            </div>
          )
        )}
        <div className="home-b-sections">
          <HomeNeeds
            timezone={timezone}
            board={board.data}
            onOpen={props.onOpen}
          />
          <HomeHabits today={today} onOpen={() => shell.openPage("/habits")} />
          <HomeFood
            today={today}
            timezone={timezone}
            now={now}
            onOpen={() => shell.openPage("/nutrition")}
          />
          <HomePins />
        </div>
      </div>
    </div>
  );
}
