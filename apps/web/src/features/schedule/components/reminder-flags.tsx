import { Flag } from "lucide-react";
import type { TrackingPreferences } from "../../time-tracking/types";
import { minuteLabel, zonedParts } from "../dates";
import type { ReminderFlag } from "../types";

export function ReminderFlags({
  reminders,
  date,
  preferences,
  onSelect,
}: {
  reminders: ReminderFlag[];
  date: string;
  preferences: TrackingPreferences;
  onSelect: (flag: ReminderFlag) => void;
}) {
  return reminders
    .filter(
      (flag) => zonedParts(flag.due_at, preferences.timezone).date === date,
    )
    .map((flag, index) => {
      const minute = zonedParts(flag.due_at, preferences.timezone).minute;
      if (minute < preferences.start_minute || minute >= preferences.end_minute)
        return null;
      return (
        <button
          className="schedule-reminder-flag"
          key={flag.message_id}
          style={{
            left: `${((minute - preferences.start_minute) / (preferences.end_minute - preferences.start_minute)) * 100}%`,
            top: 2 + (index % 3) * 5,
          }}
          onClick={() => onSelect(flag)}
          aria-label={`Reminder: ${flag.workspace_name}, ${flag.channel_name}, ${flag.content}`}
          title={`${minuteLabel(minute)} · ${flag.workspace_name} / #${flag.channel_name} · ${flag.content}`}
        >
          <Flag size={13} fill="currentColor" />
          <span>{minuteLabel(minute)}</span>
        </button>
      );
    });
}
