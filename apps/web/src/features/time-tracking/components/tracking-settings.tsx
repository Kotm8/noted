import { useState } from "react";
import { Notice } from "../../../components/ui/notice";
import { useTracking } from "../use-tracking";
import { SchedulePreferences } from "./schedule-preferences";
import { ActivitiesSettings } from "./activity-settings";
import { HistorySettings } from "./history-settings";

export type TrackingTab = "schedule" | "activities" | "history";

export function TrackingSettings({
  initialTab = "schedule",
}: {
  initialTab?: TrackingTab;
}) {
  const [tab, setTab] = useState<TrackingTab>(initialTab);
  const { tracker, activities } = useTracking();
  return (
    <section className="settings-panel tracking-settings">
      <h2>Time tracking</h2>
      <p>Global activities, your schedule, and recorded time.</p>
      <div className="tracking-settings-tabs">
        {(["schedule", "activities", "history"] as const).map((item) => (
          <button
            key={item}
            aria-pressed={tab === item}
            onClick={() => setTab(item)}
          >
            {item[0].toUpperCase() + item.slice(1)}
          </button>
        ))}
      </div>
      {(tracker.error || activities.error) && (
        <Notice tone="error">
          {(tracker.error ?? activities.error)?.message}
        </Notice>
      )}
      {tracker.data &&
        activities.data &&
        (tab === "schedule" ? (
          <SchedulePreferences tracker={tracker.data} />
        ) : tab === "activities" ? (
          <ActivitiesSettings activities={activities.data} />
        ) : (
          <HistorySettings
            activities={activities.data}
            preferences={tracker.data.preferences}
          />
        ))}
    </section>
  );
}
