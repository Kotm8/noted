const names: Record<string, string> = {
  name: "Name",
  kind: "Goal type",
  goal: "Target",
  unit: "Unit",
  period: "Time of day",
  weekdays: "Repeat days",
  activity_id: "Activity",
  timezone: "Timezone",
  starts_on: "Start date",
  reminder_start: "Reminders from",
  reminder_minute: "Reminder",
  title: "Title",
  date: "Date",
  start_minute: "Start",
  end_minute: "End",
  frequency: "Repeat",
  repeat_until: "Repeat until",
  notifications_enabled: "Notifications",
  notification_minutes: "Notify before",
  writing_nudge: "Writing nudge",
};
const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
function display(
  key: string,
  value: unknown,
  activities: Map<string, string>,
): string {
  if (value === null || value === undefined) return "Off";
  if (key === "activity_id")
    return activities.get(String(value)) ?? "Unknown activity";
  if (
    ["start_minute", "end_minute", "reminder_minute"].includes(key) &&
    typeof value === "number"
  )
    return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
  if (key === "weekdays" && Array.isArray(value))
    return value.map((day: number) => days[day]).join(", ") || "None";
  if (typeof value === "boolean") return value ? "On" : "Off";
  if (typeof value === "object") return "Configured";
  return String(value);
}
export function FieldChanges({
  before,
  after,
  activities,
}: {
  before?: object;
  after: object;
  activities: Map<string, string>;
}) {
  const previous = (before ?? {}) as Record<string, unknown>;
  const changed = Object.entries(after).filter(
    ([key, value]) =>
      names[key] && JSON.stringify(previous[key]) !== JSON.stringify(value),
  );
  return (
    <details className="shared-ai-fields">
      <summary>Review fields</summary>
      <dl>
        {changed.map(([key, value]) => (
          <div key={key}>
            <dt>{names[key]}</dt>
            <dd>
              {before && (
                <>
                  <del>{display(key, previous[key], activities)}</del>
                  <span aria-hidden="true"> → </span>
                </>
              )}
              <span>{display(key, value, activities)}</span>
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
