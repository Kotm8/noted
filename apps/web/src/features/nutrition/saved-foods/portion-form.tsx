import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Minus, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../../../components/ui/button";
import { DatePicker } from "../../../components/ui/date-picker";
import { Select } from "../../../components/ui/select";
import { Notice } from "../../../components/ui/notice";
import { nutritionApi } from "../api";
import {
  SLOTS,
  kcal,
  slotFor,
  totals,
  type SavedMeal,
  type Slot,
} from "../types";
import { macroSummary, portionGrams, scaledItems } from "./portions";
import { SavedFoodPhoto } from "./saved-food-photo";

export function PortionForm({
  food,
  day,
  minute,
  onClose,
  onBusy,
}: {
  food: SavedMeal;
  day: string;
  minute: number;
  onClose: () => void;
  onBusy: (busy: boolean) => void;
}) {
  const grams = portionGrams(food.items);
  const [amount, setAmount] = useState(grams ?? 1);
  const [date, setDate] = useState(day);
  const [slot, setSlot] = useState<Slot>(slotFor(minute));
  const items = scaledItems(food.items, amount / (grams ?? 1));
  const sums = totals(items);
  const client = useQueryClient();
  const save = useMutation({
    mutationFn: () =>
      nutritionApi.addMeal({
        day: date,
        minute,
        slot,
        name: food.name,
        items,
        source: "saved",
        saved_meal_id: food.id,
        photo_ids: food.photo_ids ?? [],
        remember: false,
      }),
    onSuccess: async (meal) => {
      await client.invalidateQueries({ queryKey: ["nutrition"] });
      onClose();
      toast.success(`${food.name} added to ${slot.toLowerCase()}`, {
        action: {
          label: "Undo",
          onClick: () =>
            void nutritionApi
              .removeMeal(meal)
              .then(() => client.invalidateQueries({ queryKey: ["nutrition"] }))
              .catch((error: Error) => toast.error(error.message)),
        },
      });
    },
  });
  useEffect(() => {
    onBusy(save.isPending);
    return () => onBusy(false);
  }, [save.isPending, onBusy]);
  const valid =
    amount > 0 &&
    Number.isFinite(amount) &&
    items.every(
      (item) =>
        item.kcal <= 6000 &&
        item.protein <= 600 &&
        item.carbs <= 900 &&
        item.fat <= 600 &&
        (item.grams ?? 0) <= 5000,
    );
  const step = grams ? 25 : 0.25;
  return (
    <form
      className="saved-food-inline"
      aria-label={`Log ${food.name}`}
      onSubmit={(event) => {
        event.preventDefault();
        if (valid && !save.isPending) save.mutate();
      }}
    >
      <div className="saved-food-inline-heading">
        <div>
          <SavedFoodPhoto id={food.photo_ids?.[0]} name={food.name} large />
          <h3>{food.name}</h3>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Close portion chooser"
          disabled={save.isPending}
          onClick={onClose}
        >
          <X size={17} />
        </button>
      </div>
      <fieldset disabled={save.isPending} className="saved-food-portion-fields">
        <label>
          <span>{grams ? "Amount" : "Portions"}</span>
          <div className="saved-food-stepper">
            <button
              type="button"
              aria-label="Less"
              onClick={() => setAmount(Math.max(step, amount - step))}
            >
              <Minus size={14} />
            </button>
            <input
              aria-label={grams ? "Grams" : "Portions"}
              type="number"
              min={grams ? 0.1 : 0.01}
              step={grams ? 0.1 : 0.25}
              value={amount}
              onChange={(event) => setAmount(Number(event.target.value))}
            />
            <span>{grams ? "g" : "portions"}</span>
            <button
              type="button"
              aria-label="More"
              onClick={() => setAmount(amount + step)}
            >
              <Plus size={14} />
            </button>
          </div>
        </label>
        <label>
          <span>Meal</span>
          <Select
            label="Meal slot"
            value={slot}
            options={SLOTS.map((value) => ({
              value,
              label: value === "Snack" ? "Snacks" : value,
            }))}
            onChange={(value) => setSlot(value as Slot)}
          />
        </label>
        <label>
          <span>Date</span>
          <DatePicker label="Log date" value={date} onChange={setDate} />
        </label>
        <div className="saved-food-portion-total">
          <strong>{kcal(sums.kcal)} kcal</strong>
          <span>{macroSummary(items)}</span>
        </div>
      </fieldset>
      {save.error && <Notice tone="error">{save.error.message}</Notice>}
      <div className="saved-food-inline-actions">
        <Button
          type="button"
          variant="ghost"
          disabled={save.isPending}
          onClick={onClose}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={!valid || save.isPending}>
          {save.isPending ? "Adding..." : "Add to diary"}
        </Button>
      </div>
    </form>
  );
}
