import { useState } from "react";
import { Minus, Plus, Sparkles, X } from "lucide-react";
import { Button } from "../../components/ui/button";
import { ConfidenceTag, MealPhoto } from "./parts";
import {
  SLOTS,
  kcal,
  scaleItem,
  totals,
  type MealEstimate,
  type MealItem,
  type Slot,
} from "./types";

export interface MealDraft {
  name: string;
  slot: Slot;
  minute: number;
  items: MealItem[];
  photo_ids: string[];
}

interface Row {
  base: MealItem;
  factor: number;
}

const STEP = 0.25;
const time = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

/**
 * An editable meal. Amounts scale an item's calories and macros together; a typed number
 * replaces the calories outright, keeping the macros in proportion.
 */
export function MealEditor({
  initial,
  question,
  note,
  rememberable,
  saveLabel = "Save meal",
  saving,
  error,
  onSave,
  onDiscard,
  status,
}: {
  initial: MealDraft;
  question?: MealEstimate["question"];
  note?: string;
  rememberable: boolean;
  saveLabel?: string;
  saving: boolean;
  error?: string | null;
  onSave: (draft: MealDraft, remember: boolean) => void;
  onDiscard: () => void;
  status?: React.ReactNode;
}) {
  const [name, setName] = useState(initial.name);
  const [slot, setSlot] = useState<Slot>(initial.slot);
  const [minute, setMinute] = useState(initial.minute);
  const [rows, setRows] = useState<Row[]>(
    initial.items.map((base) => ({ base, factor: 1 })),
  );
  const [answered, setAnswered] = useState<number | null>(null);
  const [remember, setRemember] = useState(false);
  const items = rows.map((row) => scaleItem(row.base, row.factor));
  const sum = totals(items);
  const update = (index: number, change: (row: Row) => Row) =>
    setRows((before) =>
      before.map((row, at) => (at === index ? change(row) : row)),
    );
  const complete =
    items.length > 0 && items.every((item) => item.name.trim()) && name.trim();

  return (
    <section className="nutrition-estimate" aria-label="Meal">
      <header>
        {initial.photo_ids[0] && (
          <MealPhoto id={initial.photo_ids[0]} size={52} />
        )}
        <div>
          <input
            className="estimate-name"
            aria-label="Meal name"
            value={name}
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
          />
          <small>
            <select
              aria-label="Meal"
              value={slot}
              onChange={(event) => setSlot(event.target.value as Slot)}
            >
              {SLOTS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
            <input
              type="time"
              aria-label="Time"
              value={time(minute)}
              onChange={(event) => {
                const [hours, minutes] = event.target.value
                  .split(":")
                  .map(Number);
                if (Number.isFinite(hours) && Number.isFinite(minutes))
                  setMinute(hours * 60 + minutes);
              }}
            />
          </small>
        </div>
        <span className="estimate-total">
          <strong>{kcal(sum.kcal)}</strong>
          <small>kcal</small>
        </span>
      </header>
      {status}
      <ul className="estimate-items">
        {rows.map((row, index) => {
          const item = items[index];
          return (
            <li key={index}>
              <span className="item-name">
                <input
                  aria-label="Item"
                  value={row.base.name}
                  placeholder="What is it?"
                  maxLength={80}
                  onChange={(event) =>
                    update(index, (before) => ({
                      ...before,
                      base: { ...before.base, name: event.target.value },
                    }))
                  }
                />
                <ConfidenceTag level={row.base.confidence} />
              </span>
              <span className="amount">
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Less ${row.base.name}`}
                  disabled={row.factor <= STEP}
                  onClick={() =>
                    update(index, (before) => ({
                      ...before,
                      factor: Math.max(STEP, before.factor - STEP),
                    }))
                  }
                >
                  <Minus size={13} />
                </button>
                <span title={item.amount}>{item.amount || "1 portion"}</span>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`More ${row.base.name}`}
                  onClick={() =>
                    update(index, (before) => ({
                      ...before,
                      factor: before.factor + STEP,
                    }))
                  }
                >
                  <Plus size={13} />
                </button>
              </span>
              <input
                className="item-kcal"
                type="number"
                inputMode="numeric"
                min={0}
                max={6000}
                aria-label={`Calories in ${row.base.name || "this item"}`}
                value={item.kcal}
                onChange={(event) => {
                  const value = Math.max(
                    0,
                    Math.min(6000, Number(event.target.value) || 0),
                  );
                  update(index, (before) => {
                    const ratio = before.base.kcal
                      ? value / (before.base.kcal * before.factor)
                      : 0;
                    const scale = (amount: number) =>
                      Math.round(amount * (ratio || 1) * 10) / 10;
                    return {
                      factor: before.factor,
                      base: {
                        ...before.base,
                        kcal: Math.round(value / before.factor),
                        protein: before.base.kcal
                          ? scale(before.base.protein)
                          : before.base.protein,
                        carbs: before.base.kcal
                          ? scale(before.base.carbs)
                          : before.base.carbs,
                        fat: before.base.kcal
                          ? scale(before.base.fat)
                          : before.base.fat,
                      },
                    };
                  });
                }}
              />
              <button
                type="button"
                className="icon-button remove"
                aria-label={`Remove ${row.base.name || "item"}`}
                onClick={() =>
                  setRows((before) => before.filter((_, at) => at !== index))
                }
              >
                <X size={13} />
              </button>
            </li>
          );
        })}
      </ul>
      {question &&
        answered === null &&
        rows.length === initial.items.length && (
          <div className="estimate-question">
            <span>
              <Sparkles size={13} />
              {question.text}
            </span>
            <div>
              {question.choices.map((choice, index) => (
                <button
                  key={choice.label}
                  type="button"
                  className="chip"
                  onClick={() => {
                    setAnswered(index);
                    update(choice.item, (before) => ({
                      factor: 1,
                      base: {
                        ...before.base,
                        kcal: choice.kcal,
                        protein: choice.protein,
                        carbs: choice.carbs,
                        fat: choice.fat,
                        confidence: "medium",
                      },
                    }));
                  }}
                >
                  {choice.label}
                </button>
              ))}
            </div>
          </div>
        )}
      {note && <p className="estimate-note">{note}</p>}
      {error && (
        <p className="estimate-error" role="alert">
          {error}
        </p>
      )}
      <footer>
        <Button
          variant="ghost"
          size="small"
          onClick={() =>
            setRows((before) => [
              ...before,
              {
                factor: 1,
                base: {
                  name: "",
                  amount: "",
                  kcal: 0,
                  protein: 0,
                  carbs: 0,
                  fat: 0,
                  confidence: "high",
                },
              },
            ])
          }
        >
          <Plus size={14} />
          Add item
        </Button>
        <span className="spacer" />
        {rememberable && (
          <label className="remember">
            <input
              type="checkbox"
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
            />
            Remember as a saved meal
          </label>
        )}
        <Button variant="secondary" onClick={onDiscard}>
          Discard
        </Button>
        <Button
          disabled={!complete || saving}
          onClick={() =>
            onSave(
              {
                name: name.trim(),
                slot,
                minute,
                items,
                photo_ids: initial.photo_ids,
              },
              remember,
            )
          }
        >
          {saving ? "Saving…" : saveLabel}
        </Button>
      </footer>
      <p className="estimate-hint">
        Estimates from photos can be off by a fifth or more. Check amounts you
        know.
      </p>
    </section>
  );
}

/** The estimate as it streams in, before it can be edited. */
export function StreamingEstimate({
  items,
  photoId,
  status,
  onCancel,
}: {
  items: MealItem[];
  photoId?: string;
  status: React.ReactNode;
  onCancel: () => void;
}) {
  return (
    <section
      className="nutrition-estimate"
      aria-label="Meal estimate"
      aria-busy="true"
    >
      <header>
        {photoId && <MealPhoto id={photoId} size={52} />}
        <div>
          <strong className="estimate-name">Estimating…</strong>
        </div>
        <span className="estimate-total">
          <strong>{kcal(totals(items).kcal)}</strong>
          <small>kcal so far</small>
        </span>
      </header>
      {status}
      <ul className="estimate-items readonly">
        {items.map((item, index) => (
          <li key={index} className="arrive">
            <span className="item-name">
              {item.name}
              <ConfidenceTag level={item.confidence} />
            </span>
            <span className="amount">{item.amount}</span>
            <strong className="item-kcal">{item.kcal}</strong>
          </li>
        ))}
      </ul>
      <footer>
        <span className="spacer" />
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button disabled>Writing…</Button>
      </footer>
    </section>
  );
}
