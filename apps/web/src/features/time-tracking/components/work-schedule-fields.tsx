import { useState } from "react";
import { RotateCcw, Plus } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { DatePicker } from "../../../components/ui/date-picker";
import { Select } from "../../../components/ui/select";
import { addDays, dayLabel, zonedParts } from "../../schedule/dates";
import type { WorkSchedule } from "../types";
import { isDayOff } from "../work-schedule";

const weekdays = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
const counts = Array.from({ length: 31 }, (_, i) => ({
  value: String(i + 1),
  label: `${i + 1} ${i ? "days" : "day"}`,
}));

export function WorkScheduleFields({
  value,
  timezone,
  onChange,
}: {
  value: WorkSchedule;
  timezone: string;
  onChange: (value: WorkSchedule) => void;
}) {
  const today = zonedParts(new Date().toISOString(), timezone).date;
  const [date, setDate] = useState(today);
  const [kind, setKind] = useState<"work" | "off">("off");

  function reset(date: string) {
    const overrides = { ...value.overrides };
    delete overrides[date];
    onChange({ ...value, overrides });
  }

  return (
    <section
      className="work-schedule-settings"
      aria-label="Workdays and days off"
    >
      <h3>Workdays and days off</h3>
      <p className="schedule-help">
        Days off have a lighter background. You can still plan and track on any
        day.
      </p>
      <div className="schedule-field">
        <span className="field-caption">Schedule pattern</span>
        <Select
          label="Work schedule pattern"
          value={value.mode}
          options={[
            { value: "weekly", label: "Chosen weekdays" },
            { value: "cycle", label: "Rotating cycle" },
          ]}
          onChange={(mode) =>
            onChange({
              ...value,
              mode: mode as WorkSchedule["mode"],
              cycle_start: value.cycle_start ?? today,
            })
          }
        />
      </div>
      {value.mode === "weekly" ? (
        <div className="schedule-field">
          <span className="field-caption">Days off each week</span>
          <div className="schedule-weekdays work-schedule-weekdays">
            {weekdays.map((day, index) => (
              <button
                key={day}
                type="button"
                aria-label={`${day} off`}
                aria-pressed={value.off_weekdays.includes(index)}
                onClick={() =>
                  onChange({
                    ...value,
                    off_weekdays: value.off_weekdays.includes(index)
                      ? value.off_weekdays.filter((day) => day !== index)
                      : [...value.off_weekdays, index].sort(),
                  })
                }
              >
                {day.slice(0, 3)}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <>
          <div className="work-schedule-cycle">
            <div className="schedule-field">
              <span className="field-caption">Work</span>
              <Select
                label="Consecutive workdays"
                value={String(value.work_days)}
                options={counts}
                onChange={(days) =>
                  onChange({ ...value, work_days: Number(days) })
                }
              />
            </div>
            <div className="schedule-field">
              <span className="field-caption">Then off</span>
              <Select
                label="Consecutive days off"
                value={String(value.off_days)}
                options={counts}
                onChange={(days) =>
                  onChange({ ...value, off_days: Number(days) })
                }
              />
            </div>
          </div>
          <div className="schedule-field">
            <span className="field-caption">
              First working day of the cycle
            </span>
            <DatePicker
              label="Cycle starts on"
              value={value.cycle_start ?? today}
              onChange={(cycle_start) => onChange({ ...value, cycle_start })}
            />
          </div>
          <p className="schedule-help">
            Repeats continuously across weeks and months.
          </p>
        </>
      )}
      <div className="work-schedule-preview" aria-label="Next seven days">
        {Array.from({ length: 7 }, (_, i) => addDays(today, i)).map((day) => (
          <div key={day} className={isDayOff(day, value) ? "is-day-off" : ""}>
            <span>{dayLabel(day, { weekday: "short" })}</span>
            <strong>{Number(day.slice(8))}</strong>
            <small>{isDayOff(day, value) ? "Day off" : "Workday"}</small>
          </div>
        ))}
      </div>
      <h3>One-off changes</h3>
      <p className="schedule-help">
        Take an extra day off or mark a date as a workday. Your repeating
        pattern stays the same.
      </p>
      <div className="work-schedule-override-form">
        <DatePicker label="One-off date" value={date} onChange={setDate} />
        <Select
          label="One-off day type"
          value={kind}
          options={[
            { value: "off", label: "Day off" },
            { value: "work", label: "Workday" },
          ]}
          onChange={(kind) => setKind(kind as "work" | "off")}
        />
        <Button
          type="button"
          variant="secondary"
          size="small"
          onClick={() =>
            onChange({
              ...value,
              overrides: { ...value.overrides, [date]: kind },
            })
          }
        >
          <Plus size={14} />
          Set day
        </Button>
      </div>
      {Object.entries(value.overrides)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([day, status]) => (
          <div className="work-schedule-override" key={day}>
            <span>
              {dayLabel(day, {
                weekday: "short",
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </span>
            <span>{status === "off" ? "Day off" : "Workday"}</span>
            <button
              type="button"
              className="icon-button"
              aria-label={`Reset ${day} to pattern`}
              title="Use repeating pattern"
              onClick={() => reset(day)}
            >
              <RotateCcw size={14} />
            </button>
          </div>
        ))}
    </section>
  );
}
