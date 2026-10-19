import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { Notice } from "../../../components/ui/notice";
import { DatePicker } from "../../../components/ui/date-picker";
import { SessionEditor } from "../../schedule/components/session-editor";
import { scheduleApi } from "../../schedule/api";
import { addDays, duration, wallTime, zonedParts } from "../../schedule/dates";
import type { Activity, TimeSession, TrackingPreferences } from "../types";
import { ActivityIcon } from "./activity-icon";

export function HistorySettings({
  activities,
  preferences,
}: {
  activities: Activity[];
  preferences: TrackingPreferences;
}) {
  const [date, setDate] = useState(
    () => zonedParts(Date.now(), preferences.timezone).date,
  );
  const [editing, setEditing] = useState<TimeSession | null>(null);
  const start = wallTime(date, 0, preferences.timezone);
  const end = wallTime(addDays(date, 1), 0, preferences.timezone);
  const query = useQuery({
    queryKey: ["schedule", start, end],
    queryFn: () => scheduleApi.board(start, end),
    refetchInterval: 15000,
  });
  const sessions = query.data?.sessions.filter((item) => item.ended_at) ?? [];
  const seconds = (session: TimeSession) =>
    Math.max(
      0,
      (Math.min(Date.parse(session.ended_at!), Date.parse(end)) -
        Math.max(Date.parse(session.started_at), Date.parse(start))) /
        1000,
    );
  return (
    <>
      <div className="tracking-history-heading">
        <DatePicker label="History date" value={date} onChange={setDate} />
        <strong>
          {duration(sessions.reduce((sum, item) => sum + seconds(item), 0))}{" "}
          recorded
        </strong>
      </div>
      {query.error && <Notice tone="error">{query.error.message}</Notice>}
      <div className="tracking-session-list">
        {sessions.map((item) => {
          const activity = activities.find(
            (entry) => entry.id === item.activity_id,
          );
          const format = (instant: string) =>
            new Date(instant).toLocaleString(undefined, {
              timeZone: preferences.timezone,
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
            });
          return (
            <button
              key={item.id}
              className="tracking-session-row"
              onClick={() => setEditing(item)}
            >
              {activity && <ActivityIcon activity={activity} />}
              <span>
                <strong>{activity?.name}</strong>
                <small>
                  {format(item.started_at)}–{format(item.ended_at!)}
                </small>
              </span>
              <span>{duration(seconds(item))}</span>
              <Pencil size={14} />
            </button>
          );
        })}
        {!sessions.length && !query.isPending && (
          <p className="schedule-help">No completed sessions on this day.</p>
        )}
      </div>
      <p className="schedule-help">
        The running session appears here after stopping or switching activities.
      </p>
      {editing && (
        <SessionEditor
          session={editing}
          activities={activities}
          timezone={preferences.timezone}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
