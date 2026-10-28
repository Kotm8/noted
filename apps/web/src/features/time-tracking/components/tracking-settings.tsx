import { useEffect, useRef } from "react";
import { Notice } from "../../../components/ui/notice";
import { useTracking } from "../use-tracking";
import { SchedulePreferences } from "./schedule-preferences";
import { ActivitiesSettings } from "./activity-settings";
import { HistorySettings } from "./history-settings";

export type TrackingSection = "schedule" | "activities" | "history";

export function TrackingSettings({
  initialSection,
}: {
  initialSection?: TrackingSection;
}) {
  const { tracker, activities } = useTracking();
  const panel = useRef<HTMLElement>(null);
  const ready = Boolean(tracker.data && activities.data);
  useEffect(() => {
    if (!ready || !initialSection) return;
    panel.current
      ?.querySelector(`[data-section="${initialSection}"]`)
      ?.scrollIntoView({ block: "start" });
  }, [ready, initialSection]);
  return (
    <section className="settings-panel tracking-settings" ref={panel}>
      <h2>Time tracking</h2>
      <p>Global activities, your schedule, and recorded time.</p>
      {(tracker.error || activities.error) && (
        <Notice tone="error">
          {(tracker.error ?? activities.error)?.message}
        </Notice>
      )}
      {tracker.data && activities.data && (
        <>
          <section className="tracking-section" data-section="activities">
            <ActivitiesSettings activities={activities.data} />
          </section>
          <section className="tracking-section" data-section="schedule">
            <SchedulePreferences tracker={tracker.data} />
          </section>
          <section className="tracking-section" data-section="history">
            <h3>History</h3>
            <HistorySettings
              activities={activities.data}
              preferences={tracker.data.preferences}
            />
          </section>
        </>
      )}
    </section>
  );
}
