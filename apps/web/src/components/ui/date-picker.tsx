import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Select } from "./select";
import { useAndroidBackLayer } from "../../lib/android-navigation";

export function DatePicker({
  value,
  onChange,
  label = "Choose date",
  optional = false,
  displayLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  optional?: boolean;
  displayLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  useAndroidBackLayer(open, () => setOpen(false));
  const [month, setMonth] = useState(
    () =>
      new Date(`${value || new Date().toISOString().slice(0, 10)}T12:00:00`),
  );
  const year = month.getFullYear();
  const count = new Date(year, month.getMonth() + 1, 0).getDate();
  const offset = (new Date(year, month.getMonth(), 1).getDay() + 6) % 7;
  const move = (step: number) =>
    setMonth(new Date(year, month.getMonth() + step, 1));
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (next && value) setMonth(new Date(`${value}T12:00:00`));
        setOpen(next);
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          className="date-picker-trigger"
          aria-label={label}
        >
          <CalendarDays size={16} />
          <span>
            {displayLabel ??
              (value
                ? new Date(`${value}T12:00:00`).toLocaleDateString(undefined, {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })
                : "No end date")}
          </span>
          <ChevronDown size={15} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="date-calendar"
          align="start"
          sideOffset={6}
          collisionPadding={12}
          aria-label={label}
        >
          <div className="date-calendar-heading">
            <button
              className="icon-button"
              type="button"
              aria-label="Previous month"
              onClick={() => move(-1)}
            >
              <ChevronLeft size={16} />
            </button>
            <Select
              label="Month"
              value={String(month.getMonth())}
              options={Array.from({ length: 12 }, (_, index) => ({
                value: String(index),
                label: new Date(2026, index).toLocaleString(undefined, {
                  month: "long",
                }),
              }))}
              onChange={(next) => setMonth(new Date(year, Number(next), 1))}
            />
            <Select
              label="Year"
              value={String(year)}
              options={Array.from({ length: 41 }, (_, index) => ({
                value: String(year - 20 + index),
                label: String(year - 20 + index),
              }))}
              onChange={(next) =>
                setMonth(new Date(Number(next), month.getMonth(), 1))
              }
            />
            <button
              className="icon-button"
              type="button"
              aria-label="Next month"
              onClick={() => move(1)}
            >
              <ChevronRight size={16} />
            </button>
          </div>
          <div className="date-calendar-grid">
            {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((day) => (
              <span key={day}>{day}</span>
            ))}
            {Array.from({ length: offset }, (_, index) => (
              <span key={`blank-${index}`} />
            ))}
            {Array.from({ length: count }, (_, index) => {
              const date = `${year}-${String(month.getMonth() + 1).padStart(2, "0")}-${String(index + 1).padStart(2, "0")}`;
              return (
                <button
                  type="button"
                  key={date}
                  aria-label={`Choose ${date}`}
                  aria-pressed={value === date}
                  onClick={() => {
                    onChange(date);
                    setOpen(false);
                  }}
                >
                  {index + 1}
                </button>
              );
            })}
          </div>
          {optional && (
            <button
              type="button"
              className="button-ghost"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
            >
              No end date
            </button>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
