import { Select } from "../../../components/ui/select";
import { minuteLabel } from "../dates";

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
  const values = Array.from(
    { length: end ? 97 : 96 },
    (_, index) => index * 15,
  );
  if (!values.includes(value)) values.push(value);
  return (
    <div className="schedule-field">
      <span className="field-caption">{label}</span>
      <Select
        label={label}
        value={String(value)}
        options={values
          .sort((a, b) => a - b)
          .map((minute) => ({
            value: String(minute),
            label: minute === 1440 ? "24:00 · midnight" : minuteLabel(minute),
          }))}
        onChange={(next) => onChange(Number(next))}
      />
    </div>
  );
}
