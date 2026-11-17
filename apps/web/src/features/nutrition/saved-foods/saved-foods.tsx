import { ContextMenu } from "../../../components/ui/context-menu";
import { MenuItem } from "../../../components/ui/menu";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../../../components/ui/button";
import { ConfirmDialog } from "../../../components/ui/confirm-dialog";
import { Notice } from "../../../components/ui/notice";
import { Select } from "../../../components/ui/select";
import { nutritionApi } from "../api";
import { kcal, totals, type SavedMeal } from "../types";
import { FoodEditor } from "./food-editor";
import { PortionForm } from "./portion-form";
import { portionLabel } from "./portions";
import { SavedFoodPhoto } from "./saved-food-photo";
import "./saved-foods.css";

type Panel =
  | { kind: "log" | "edit" | "delete"; id: string }
  | { kind: "new" }
  | null;

export function SavedFoods({
  foods,
  day,
  minute,
  onDirty,
  onBusy,
}: {
  foods: SavedMeal[];
  day: string;
  minute: number;
  onDirty: (dirty: boolean) => void;
  onBusy: (busy: boolean) => void;
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("used");
  const [panel, setPanel] = useState<Panel>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [next, setNext] = useState<{ panel: Panel } | null>(null);
  const client = useQueryClient();
  const reportDirty = useCallback(
    (value: boolean) => {
      setDirty(value);
      onDirty(value);
    },
    [onDirty],
  );
  const reportBusy = useCallback(
    (value: boolean) => {
      setBusy(value);
      onBusy(value);
    },
    [onBusy],
  );
  function request(value: Panel) {
    if (dirty) setNext({ panel: value });
    else setPanel(value);
  }
  const shown = useMemo(
    () =>
      foods
        .filter(
          (food) =>
            (filter === "all" ||
              (food.items.length > 1 ? "meals" : "foods") === filter) &&
            `${food.name} ${food.items.map((item) => item.name).join(" ")}`
              .toLowerCase()
              .includes(search.trim().toLowerCase()),
        )
        .sort((a, b) =>
          sort === "name"
            ? a.name.localeCompare(b.name)
            : sort === "calories"
              ? totals(a.items).kcal - totals(b.items).kcal
              : b.uses - a.uses || a.name.localeCompare(b.name),
        ),
    [foods, filter, search, sort],
  );
  const remove = useMutation({
    mutationFn: (food: SavedMeal) =>
      nutritionApi.removeSaved(food.id, food.revision),
    onSuccess: async () => {
      setPanel(null);
      await client.invalidateQueries({ queryKey: ["nutrition"] });
      toast.success("Saved food removed");
    },
  });
  useEffect(() => {
    onBusy(busy || remove.isPending);
    return () => onBusy(false);
  }, [busy, remove.isPending, onBusy]);
  const blocked = busy || remove.isPending;
  const editor = (food?: SavedMeal) => (
    <FoodEditor
      key={food?.id ?? "new"}
      food={food}
      onClose={() => request(null)}
      onDirty={reportDirty}
      onBusy={reportBusy}
      onSaved={() => {
        reportDirty(false);
        setPanel(null);
      }}
    />
  );
  return (
    <section className="saved-foods" aria-label="Saved foods">
      <div className="saved-foods-heading">
        <div>
          <h2>Saved foods</h2>
          <p>Foods and meals, ready to log again.</p>
        </div>
        <Button
          variant="secondary"
          disabled={blocked}
          onClick={() => request({ kind: "new" })}
        >
          <Plus size={15} />
          Save a food
        </Button>
      </div>
      <div className="saved-foods-tools">
        <label className="saved-foods-search">
          <Search size={15} />
          <input
            aria-label="Search saved foods"
            placeholder="Search foods and meals"
            value={search}
            disabled={dirty || blocked}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <div
          className="saved-foods-filters"
          role="group"
          aria-label="Saved food filter"
        >
          {["all", "foods", "meals"].map((value) => (
            <button
              key={value}
              disabled={dirty || blocked}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {value[0].toUpperCase() + value.slice(1)}
            </button>
          ))}
        </div>
        <Select
          label="Sort saved foods"
          value={sort}
          options={[
            { value: "used", label: "Most used" },
            { value: "name", label: "Name" },
            { value: "calories", label: "Calories" },
          ]}
          onChange={setSort}
        />
      </div>
      {panel?.kind === "new" && editor()}
      <div className="saved-food-columns" aria-hidden="true">
        <span>Food</span>
        <span>kcal</span>
        <span>Protein</span>
        <span>Carbs</span>
        <span>Fat</span>
        <span />
      </div>
      {shown.map((food) => {
        const sum = totals(food.items);
        const active =
          panel && "id" in panel && panel.id === food.id ? panel.kind : null;
        return (
          <ContextMenu
            key={food.id}
            disabled={blocked}
            label={`Actions for saved food ${food.name}`}
            menu={
              <>
                <MenuItem
                  onSelect={() => request({ kind: "log", id: food.id })}
                >
                  Log food
                </MenuItem>
                <MenuItem
                  onSelect={() => request({ kind: "edit", id: food.id })}
                >
                  Edit saved food
                </MenuItem>
                <MenuItem
                  danger
                  onSelect={() => request({ kind: "delete", id: food.id })}
                >
                  Delete saved food
                </MenuItem>
              </>
            }
          >
            <article className={`saved-food-entry ${active ? "expanded" : ""}`}>
              <div className="saved-food-row">
                <button
                  className="saved-food-name"
                  disabled={blocked}
                  aria-expanded={active === "log"}
                  onClick={() =>
                    request(
                      active === "log" ? null : { kind: "log", id: food.id },
                    )
                  }
                >
                  <SavedFoodPhoto id={food.photo_ids?.[0]} name={food.name} />
                  <span>
                    <strong>{food.name}</strong>
                    <small>{portionLabel(food.items)}</small>
                  </span>
                </button>
                <span className="saved-food-number">
                  {kcal(sum.kcal)}
                  <small>kcal</small>
                </span>
                {(["protein", "carbs", "fat"] as const).map((key) => (
                  <span key={key} className="saved-food-number macro">
                    {Math.round(sum[key] * 10) / 10}
                    <small>{key}</small>
                  </span>
                ))}
                <div className="saved-food-actions">
                  <button
                    className="icon-button"
                    disabled={blocked}
                    aria-label={`Edit ${food.name}`}
                    onClick={() => request({ kind: "edit", id: food.id })}
                  >
                    <Pencil size={15} />
                  </button>
                  <Button
                    size="small"
                    variant="secondary"
                    disabled={blocked}
                    aria-label={`Log ${food.name}`}
                    onClick={() =>
                      request(
                        active === "log" ? null : { kind: "log", id: food.id },
                      )
                    }
                  >
                    <Plus size={14} />
                    Log
                  </Button>
                </div>
              </div>
              {active === "log" && (
                <PortionForm
                  food={food}
                  day={day}
                  minute={minute}
                  onClose={() => setPanel(null)}
                  onBusy={reportBusy}
                />
              )}
              {active === "edit" && (
                <>
                  {editor(food)}
                  <div className="saved-food-delete-action">
                    <Button
                      variant="ghost"
                      size="small"
                      disabled={blocked}
                      onClick={() => request({ kind: "delete", id: food.id })}
                    >
                      <Trash2 size={14} />
                      Delete saved food
                    </Button>
                  </div>
                </>
              )}
              {active === "delete" && (
                <div
                  className="saved-food-inline"
                  role="region"
                  aria-label={`Delete ${food.name}`}
                >
                  <h3>Delete {food.name}?</h3>
                  <p>Meals already in your diary will stay.</p>
                  {remove.error && (
                    <Notice tone="error">{remove.error.message}</Notice>
                  )}
                  <div className="saved-food-inline-actions">
                    <Button
                      variant="ghost"
                      disabled={remove.isPending}
                      onClick={() => setPanel(null)}
                    >
                      Keep it
                    </Button>
                    <Button
                      variant="danger"
                      disabled={remove.isPending}
                      onClick={() => remove.mutate(food)}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              )}
            </article>
          </ContextMenu>
        );
      })}
      {!shown.length && (
        <p className="saved-foods-empty">
          {foods.length
            ? "No foods match your search."
            : "Save a food here, or remember a meal from your diary."}
        </p>
      )}
      <p className="saved-foods-count">
        {foods.length} saved {foods.length === 1 ? "food" : "foods"}
      </p>
      <ConfirmDialog
        open={next !== null}
        title="Discard unsaved food changes?"
        description="Your saved food will stay as it was."
        keepLabel="Keep editing"
        confirmLabel="Discard changes"
        onClose={() => setNext(null)}
        onConfirm={() => {
          const value = next?.panel ?? null;
          setDirty(false);
          onDirty(false);
          setPanel(value);
          setNext(null);
        }}
      />
    </section>
  );
}
