import type { CSSProperties } from "react";
import { ArrowRight } from "lucide-react";
import type { Activity } from "../../time-tracking/types";
import type { PlanFields } from "../types";
import { duration } from "../dates";
import { TimeField } from "./time-field";

type QuickFields = Pick<
  PlanFields,
  "title" | "activity_id" | "start_minute" | "end_minute"
>;

export function PlanQuickFields({
  fields,
  activities,
  onChange,
}: {
  fields: QuickFields;
  activities: Activity[];
  onChange: (fields: QuickFields) => void;
}) {
  const length = fields.end_minute - fields.start_minute;
  return (
    <>
      <input
        className="plan-card-title"
        aria-label="Title"
        value={fields.title}
        maxLength={120}
        autoFocus
        placeholder={
          activities.find((item) => item.id === fields.activity_id)?.name ??
          "Activity"
        }
        onChange={(event) => onChange({ ...fields, title: event.target.value })}
      />
      <div className="plan-card-activities" role="group" aria-label="Activity">
        {activities
          .filter((item) => !item.archived || item.id === fields.activity_id)
          .map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={item.id === fields.activity_id}
              style={{ "--activity": item.color } as CSSProperties}
              onClick={() => onChange({ ...fields, activity_id: item.id })}
            >
              <i aria-hidden="true" />
              {item.name}
            </button>
          ))}
      </div>
      <div className="plan-card-times">
        <TimeField
          label="Start"
          value={fields.start_minute}
          onChange={(start) =>
            onChange({
              ...fields,
              start_minute: start,
              end_minute: Math.min(1440, start + length),
            })
          }
        />
        <ArrowRight size={14} aria-hidden="true" />
        <TimeField
          label="End"
          end
          value={fields.end_minute}
          onChange={(end) => onChange({ ...fields, end_minute: end })}
        />
        <span className="plan-card-length">
          {length > 0 ? duration(length * 60) : "Invalid range"}
        </span>
      </div>
    </>
  );
}
