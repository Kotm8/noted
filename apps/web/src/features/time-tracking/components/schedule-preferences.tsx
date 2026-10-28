import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Info } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../../../components/ui/button";
import { Notice } from "../../../components/ui/notice";
import { Select } from "../../../components/ui/select";
import { TimeField } from "../../schedule/components/time-field";
import { trackingApi } from "../api";
import type { Tracker, TrackingPreferences } from "../types";

export function SchedulePreferences({ tracker }: { tracker: Tracker }) {
  const [preferences, setPreferences] = useState(tracker.preferences);
  const revision = useRef(tracker.revision);
  const pending = useRef<number | undefined>(undefined);
  const client = useQueryClient();
  const zones = [
    ...new Set([
      preferences.timezone,
      Intl.DateTimeFormat().resolvedOptions().timeZone,
      "UTC",
      ...Intl.supportedValuesOf("timeZone"),
    ]),
  ];
  const save = useMutation({
    scope: { id: "schedule-preferences" },
    mutationFn: (values: TrackingPreferences) =>
      trackingApi.preferences(values, revision.current),
    onSuccess: (data) => {
      client.setQueryData(["time-tracker"], data);
      void client.invalidateQueries({ queryKey: ["schedule"] });
      revision.current = data.revision;
    },
    onError: () => {
      void client.invalidateQueries({ queryKey: ["time-tracker"] });
    },
  });
  useEffect(() => () => window.clearTimeout(pending.current), []);
  /** Arrow keys step the hours quickly, so saves wait for a short pause. */
  function change(values: TrackingPreferences) {
    setPreferences(values);
    window.clearTimeout(pending.current);
    pending.current = window.setTimeout(() => save.mutate(values), 400);
  }
  return (
    <div>
      <h3>Visible hours</h3>
      <p className="schedule-help">
        Choose where your board starts and ends. Activities and reminders
        outside these hours are kept.
      </p>
      <div className="schedule-time-fields">
        <TimeField
          label="Schedule start"
          value={preferences.start_minute}
          onChange={(start_minute) => change({ ...preferences, start_minute })}
        />
        <TimeField
          label="Schedule end"
          value={preferences.end_minute}
          end
          onChange={(end_minute) => change({ ...preferences, end_minute })}
        />
      </div>
      <div className="schedule-field">
        <span className="field-caption">Timezone</span>
        <Select
          label="Schedule timezone"
          value={preferences.timezone}
          options={zones.map((zone) => ({
            value: zone,
            label: zone.replaceAll("_", " "),
          }))}
          onChange={(timezone) => change({ ...preferences, timezone })}
        />
      </div>
      <p className="schedule-help">
        <Info size={14} />
        Saved to your account and shared across devices. Existing repeating
        plans keep their original timezone.
      </p>
      {save.error && (
        <Notice tone="error">
          {save.error.message}
          <Button
            type="button"
            variant="ghost"
            size="small"
            onClick={() => {
              void client
                .fetchQuery({
                  queryKey: ["time-tracker"],
                  queryFn: trackingApi.tracker,
                  staleTime: 0,
                })
                .then((data) => {
                  setPreferences(data.preferences);
                  revision.current = data.revision;
                  save.reset();
                })
                .catch((error: Error) => toast.error(error.message));
            }}
          >
            Reload saved settings
          </Button>
        </Notice>
      )}
      <p className="settings-hint" role="status">
        {save.isPending ? "Saving…" : ""}
      </p>
    </div>
  );
}
