import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, Plus, Trash2, X } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Notice } from "../../../components/ui/notice";
import { nutritionApi } from "../api";
import { kcal, totals, type MealItem, type SavedMeal } from "../types";
import { SavedFoodPhoto } from "./saved-food-photo";

const blankItem = (): MealItem => ({
  name: "",
  amount: "",
  grams: null,
  kcal: 0,
  protein: 0,
  carbs: 0,
  fat: 0,
  confidence: "high",
});

export function FoodEditor({
  food: initial,
  onClose,
  onDirty,
  onBusy,
  onSaved,
}: {
  food?: SavedMeal;
  onClose: () => void;
  onDirty: (dirty: boolean) => void;
  onBusy: (busy: boolean) => void;
  onSaved: () => void;
}) {
  const [food] = useState(initial);
  const [name, setName] = useState(food?.name ?? "");
  const [items, setItems] = useState<MealItem[]>(food?.items ?? [blankItem()]);
  const [photos, setPhotos] = useState<string[]>(food?.photo_ids ?? []);
  const file = useRef<HTMLInputElement>(null);
  const dirty =
    JSON.stringify({ name, items, photos }) !==
    JSON.stringify({
      name: food?.name ?? "",
      items: food?.items ?? [blankItem()],
      photos: food?.photo_ids ?? [],
    });
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);
  const client = useQueryClient();
  const upload = useMutation({
    mutationFn: nutritionApi.uploadPhoto,
    onSuccess: (photo) => setPhotos([photo.id]),
  });
  const save = useMutation({
    mutationFn: () =>
      food
        ? nutritionApi.editSaved(food.id, {
            name: name.trim(),
            items,
            photo_ids: photos,
            revision: food.revision,
          })
        : nutritionApi.addSaved(name.trim(), items, photos),
    onSuccess: async () => {
      onDirty(false);
      await client.invalidateQueries({ queryKey: ["nutrition"] });
      onSaved();
    },
  });
  const busy = upload.isPending || save.isPending;
  useEffect(() => {
    onBusy(busy);
    return () => onBusy(false);
  }, [busy, onBusy]);
  const setItem = (index: number, changes: Partial<MealItem>) =>
    setItems((values) =>
      values.map((item, at) => (at === index ? { ...item, ...changes } : item)),
    );
  const valid =
    name.trim() &&
    items.length &&
    items.every(
      (item) =>
        item.name.trim() &&
        [item.kcal, item.protein, item.carbs, item.fat].every(
          (n) => Number.isFinite(n) && n >= 0,
        ),
    );
  return (
    <form
      className="saved-food-inline saved-food-editor"
      aria-label={food ? `Edit ${food.name}` : "Save a food"}
      onSubmit={(event) => {
        event.preventDefault();
        if (valid && !busy) save.mutate();
      }}
    >
      <div className="saved-food-inline-heading">
        <h3>{food ? `Edit ${food.name}` : "Save a food"}</h3>
        <button
          type="button"
          className="icon-button"
          aria-label="Close food editor"
          disabled={busy}
          onClick={onClose}
        >
          <X size={17} />
        </button>
      </div>
      <fieldset disabled={busy}>
        <div className="saved-food-photo-editor">
          <SavedFoodPhoto id={photos[0]} name={name} large />
          <div>
            <Button
              type="button"
              variant="secondary"
              onClick={() => file.current?.click()}
            >
              <ImagePlus size={15} />
              {upload.isPending
                ? "Uploading..."
                : photos.length
                  ? "Replace photo"
                  : "Add photo"}
            </Button>
            {photos.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => setPhotos([])}
              >
                Remove photo
              </Button>
            )}
          </div>
          <input
            hidden
            ref={file}
            aria-label="Food photo"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            onChange={(event) => {
              const photo = event.target.files?.[0];
              event.target.value = "";
              if (photo) upload.mutate(photo);
            }}
          />
        </div>
        <label className="saved-food-title-field">
          Name
          <input
            autoFocus
            required
            maxLength={80}
            value={name}
            onChange={(event) => {
              const value = event.target.value;
              if (
                items.length === 1 &&
                (!items[0].name || items[0].name === name)
              )
                setItems([{ ...items[0], name: value }]);
              setName(value);
            }}
          />
        </label>
        <div className="saved-food-editor-items">
          {items.map((item, index) => (
            <div className="saved-food-editor-item" key={index}>
              <label>
                Item
                <input
                  aria-label={`Item ${index + 1} name`}
                  required
                  maxLength={80}
                  value={item.name}
                  onChange={(event) =>
                    setItem(index, { name: event.target.value })
                  }
                />
              </label>
              <label>
                Portion
                <input
                  aria-label={`Item ${index + 1} portion`}
                  maxLength={40}
                  placeholder="1 bowl"
                  value={item.amount}
                  onChange={(event) =>
                    setItem(index, { amount: event.target.value })
                  }
                />
              </label>
              <label>
                Grams
                <input
                  aria-label={`Item ${index + 1} grams`}
                  type="number"
                  min={0}
                  max={5000}
                  step={0.1}
                  placeholder="Optional"
                  value={item.grams ?? ""}
                  onChange={(event) =>
                    setItem(index, {
                      grams:
                        event.target.value === ""
                          ? null
                          : Number(event.target.value),
                    })
                  }
                />
              </label>
              {(["kcal", "protein", "carbs", "fat"] as const).map((key) => (
                <label key={key}>
                  {key === "kcal"
                    ? "kcal"
                    : `${key[0].toUpperCase()}${key.slice(1)} g`}
                  <input
                    aria-label={`Item ${index + 1} ${key}`}
                    type="number"
                    min={0}
                    max={
                      { kcal: 6000, protein: 600, carbs: 900, fat: 600 }[key]
                    }
                    step={key === "kcal" ? 1 : 0.1}
                    value={item[key]}
                    onChange={(event) =>
                      setItem(index, { [key]: Number(event.target.value) })
                    }
                  />
                </label>
              ))}
              <button
                type="button"
                className="icon-button"
                aria-label={`Remove item ${index + 1}`}
                disabled={items.length === 1}
                onClick={() =>
                  setItems((values) => values.filter((_, at) => at !== index))
                }
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="small"
          disabled={items.length >= 40}
          onClick={() => setItems((values) => [...values, blankItem()])}
        >
          <Plus size={14} />
          Add item
        </Button>
      </fieldset>
      {(upload.error || save.error) && (
        <Notice tone="error">{(upload.error ?? save.error)?.message}</Notice>
      )}
      <div className="saved-food-inline-actions">
        <span>{kcal(totals(items).kcal)} kcal per saved portion</span>
        <div>
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={!valid || busy}>
            {save.isPending ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>
    </form>
  );
}
