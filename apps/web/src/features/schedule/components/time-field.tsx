import { useState } from "react";
import { minuteLabel, parseTime, stepTime } from "../dates";

/** Typed 24-hour time. Arrow keys move by 15 minutes, Shift+arrow by an hour. */
export function TimeField({
  label,
  value,
  onChange,
  end = false,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  end?: boolean;
}) {
  const [typed, setTyped] = useState<string | null>(null);
  const parsed = typed === null ? value : parseTime(typed);
  function commit(next: number) {
    onChange(Math.min(end ? 1440 : 1439, Math.max(0, next)));
    setTyped(null);
  }
  return (
    <div className="schedule-field">
      <span className="field-caption">{label}</span>
      <input
        className="time-input"
        aria-label={label}
        aria-invalid={parsed === null}
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        maxLength={5}
        value={typed ?? minuteLabel(value)}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => setTyped(event.target.value)}
        onBlur={() =>
          typed !== null && parsed !== null ? commit(parsed) : setTyped(null)
        }
        onKeyDown={(event) => {
          if (event.key === "Enter" && typed !== null) {
            event.preventDefault();
            if (parsed !== null) commit(parsed);
          } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            const input = event.currentTarget;
            const direction = event.key === "ArrowUp" ? 1 : -1;
            commit(stepTime(value, direction, event.shiftKey ? 60 : 15));
            requestAnimationFrame(() => input.select());
          }
        }}
      />
    </div>
  );
}
