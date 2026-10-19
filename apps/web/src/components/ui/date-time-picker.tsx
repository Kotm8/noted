import { useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Select } from "./select";

export function localDateTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function DateTimePicker({
  value,
  onChange,
  min = localDateTime(new Date()),
  label = "Choose reminder date",
}: {
  value: string;
  onChange: (value: string) => void;
  min?: string;
  label?: string;
}) {
  const [month, setMonth] = useState(
    () => new Date(`${value.slice(0, 7)}-01T12:00`),
  );
  const [open, setOpen] = useState(false);
  const calendar = useRef<HTMLDivElement>(null);
  const date = value.slice(0, 10);
  const years = Array.from(
    { length: 11 },
    (_, index) => new Date().getFullYear() + index,
  );
  function move(offset: number) {
    setMonth(new Date(month.getFullYear(), month.getMonth() + offset, 1));
  }
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const offset = (month.getDay() + 6) % 7;
  const options = (count: number) =>
    Array.from({ length: count }, (_, number) => ({
      value: String(number).padStart(2, "0"),
      label: String(number).padStart(2, "0"),
    }));
  return (
    <div className="date-time-picker">
      <div>
        <span className="field-caption">Date</span>
        <Popover.Root
          open={open}
          onOpenChange={(next) => {
            if (next) setMonth(new Date(`${date.slice(0, 7)}-01T12:00`));
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
                {new Date(`${date}T12:00`).toLocaleDateString(undefined, {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </span>
              <ChevronDown size={15} />
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              ref={calendar}
              className="date-calendar"
              aria-label="Choose date"
              align="start"
              sideOffset={6}
              collisionPadding={12}
              onOpenAutoFocus={(event) => {
                event.preventDefault();
                (
                  calendar.current?.querySelector(
                    '[aria-pressed="true"]:not(:disabled)',
                  ) as HTMLButtonElement | null
                )?.focus();
              }}
            >
              <div className="date-calendar-heading">
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Previous month"
                  disabled={
                    localDateTime(
                      new Date(month.getFullYear(), month.getMonth(), 0),
                    ).slice(0, 10) < min.slice(0, 10)
                  }
                  onClick={() => move(-1)}
                >
                  <ChevronLeft size={16} />
                </button>
                <Select
                  label="Month"
                  value={String(month.getMonth())}
                  options={Array.from({ length: 12 }, (_, number) => ({
                    value: String(number),
                    label: new Date(2026, number, 1).toLocaleString(undefined, {
                      month: "long",
                    }),
                  }))}
                  onChange={(next) =>
                    setMonth(new Date(month.getFullYear(), Number(next), 1))
                  }
                />
                <Select
                  label="Year"
                  value={String(month.getFullYear())}
                  options={years.map((year) => ({
                    value: String(year),
                    label: String(year),
                  }))}
                  onChange={(next) =>
                    setMonth(new Date(Number(next), month.getMonth(), 1))
                  }
                />
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Next month"
                  disabled={
                    month.getFullYear() === years.at(-1) &&
                    month.getMonth() === 11
                  }
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
                {Array.from({ length: days }, (_, index) => {
                  const day = index + 1;
                  const next = localDateTime(
                    new Date(month.getFullYear(), month.getMonth(), day, 12),
                  ).slice(0, 10);
                  return (
                    <button
                      key={day}
                      type="button"
                      aria-label={`Choose ${next}`}
                      aria-pressed={next === date}
                      data-date={next}
                      disabled={next < min.slice(0, 10)}
                      onClick={() => {
                        onChange(`${next}T${value.slice(11)}`);
                        setOpen(false);
                      }}
                      onKeyDown={(event) => {
                        const shifts: Record<string, number> = {
                          ArrowLeft: -1,
                          ArrowRight: 1,
                          ArrowUp: -7,
                          ArrowDown: 7,
                        };
                        if (!(event.key in shifts)) return;
                        event.preventDefault();
                        const target = new Date(`${next}T12:00`);
                        target.setDate(target.getDate() + shifts[event.key]);
                        const day = localDateTime(target).slice(0, 10);
                        if (
                          day < min.slice(0, 10) ||
                          target.getFullYear() > years.at(-1)!
                        )
                          return;
                        setMonth(
                          new Date(target.getFullYear(), target.getMonth(), 1),
                        );
                        requestAnimationFrame(() =>
                          (
                            calendar.current?.querySelector(
                              `[data-date="${day}"]`,
                            ) as HTMLButtonElement | null
                          )?.focus(),
                        );
                      }}
                    >
                      {day}
                    </button>
                  );
                })}
              </div>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </div>
      <div>
        <span className="field-caption">Time · 24 hour</span>
        <div className="time-picker">
          <Select
            label="Hour"
            value={value.slice(11, 13)}
            options={options(24)}
            onChange={(hour) =>
              onChange(`${date}T${hour}:${value.slice(14, 16)}`)
            }
          />
          <span>:</span>
          <Select
            label="Minute"
            value={value.slice(14, 16)}
            options={options(60)}
            onChange={(minute) =>
              onChange(`${date}T${value.slice(11, 13)}:${minute}`)
            }
          />
        </div>
      </div>
    </div>
  );
}
