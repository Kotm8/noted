import { Globe, LoaderCircle, Minus, Plus } from "lucide-react";
import { photoUrl } from "./api";
import type { Confidence } from "./types";
import { kcal } from "./types";
import type { RunState } from "./use-nutrition-run";

/** Eaten against the target, with what's left (or over) in the middle. */
export function Ring({
  eaten,
  target,
  size = 168,
}: {
  eaten: number;
  target: number;
  size?: number;
}) {
  const stroke = 12;
  const radius = (size - stroke) / 2;
  const length = 2 * Math.PI * radius;
  const over = eaten > target;
  const share = target ? Math.min(1, eaten / target) : 0;
  return (
    <div className="nutrition-ring" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          className="ring-track"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          className={`ring-fill${over ? " over" : ""}`}
          strokeWidth={stroke}
          strokeDasharray={length}
          strokeDashoffset={length * (1 - share)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="ring-label">
        <strong>{kcal(Math.abs(target - eaten))}</strong>
        <span>{over ? "kcal over" : "kcal left"}</span>
      </div>
    </div>
  );
}

export function MacroBars({
  eaten,
  target,
}: {
  eaten: { protein: number; carbs: number; fat: number };
  target: { protein: number; carbs: number; fat: number };
}) {
  return (
    <div className="nutrition-macros">
      {(
        [
          ["Protein", "protein"],
          ["Carbs", "carbs"],
          ["Fat", "fat"],
        ] as const
      ).map(([label, key]) => (
        <div key={key} className={`nutrition-macro ${key}`}>
          <div>
            <span>{label}</span>
            <small>
              <strong>{Math.round(eaten[key])}</strong> / {target[key]} g
            </small>
          </div>
          <span className="macro-track">
            <span
              style={{
                width: `${Math.min(100, (eaten[key] / Math.max(1, target[key])) * 100)}%`,
              }}
            />
          </span>
        </div>
      ))}
    </div>
  );
}

const CONFIDENCE: Record<Confidence, string> = {
  high: "Sure",
  medium: "Rough guess",
  low: "Unsure",
};

export function ConfidenceTag({ level }: { level: Confidence }) {
  return (
    <span className={`nutrition-confidence ${level}`}>{CONFIDENCE[level]}</span>
  );
}

export function MealPhoto({ id, size = 44 }: { id: string; size?: number }) {
  return (
    <img
      className="nutrition-photo"
      src={photoUrl(id)}
      alt="Meal photo"
      width={size}
      height={size}
      loading="lazy"
    />
  );
}

/** Thinking, searching, or how long it thought once it's done, as in the other AI views. */
export function RunStatus<T>({
  run,
  thinking = "Thinking",
}: {
  run: RunState<T>;
  thinking?: string;
}) {
  if (run.stage === "thinking")
    return (
      <div className="ai-thinking" role="status">
        <LoaderCircle size={14} className="spin" />
        <span className="ai-shimmer">{thinking}</span>
        {run.heading && <small>{run.heading}</small>}
      </div>
    );
  if (run.stage === "searching")
    return (
      <div className="ai-thinking" role="status">
        <Globe size={14} />
        <span className="ai-shimmer">Searching the web</span>
        {run.query && <small title={run.query}>{run.query}</small>}
      </div>
    );
  if (run.thoughtSeconds === null) return null;
  return (
    <div className="ai-thought">
      Thought for {Math.max(1, Math.round(run.thoughtSeconds))}s
      {run.searched && " · searched the web"}
    </div>
  );
}

export function Stepper({
  label,
  value,
  unit,
  step,
  onChange,
}: {
  label: string;
  value: number;
  unit: string;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="nutrition-stepper">
      <span>{label}</span>
      <div>
        <button
          type="button"
          className="icon-button"
          aria-label={`Lower ${label}`}
          onClick={() => onChange(value - step)}
        >
          <Minus size={13} />
        </button>
        <strong>{kcal(value)}</strong>
        <button
          type="button"
          className="icon-button"
          aria-label={`Raise ${label}`}
          onClick={() => onChange(value + step)}
        >
          <Plus size={13} />
        </button>
      </div>
      <small>{unit}</small>
    </div>
  );
}
