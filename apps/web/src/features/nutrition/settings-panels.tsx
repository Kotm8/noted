import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Bookmark, Plus, Search, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../../components/ui/button";
import { ConfirmDialog } from "../../components/ui/confirm-dialog";
import { Notice } from "../../components/ui/notice";
import { AiSources } from "../ai/components/ai-feedback";
import { Switch } from "../ai/components/ai-settings-panel";
import { useAiPreferences } from "../ai/queries";
import { dayLabel } from "../schedule/dates";
import { nutritionApi } from "./api";
import {
  ACTIVITIES,
  kcal,
  totals,
  type MealItem,
  type ProfileFields,
  type SavedMeal,
} from "./types";

const useNutritionState = () =>
  useQuery({ queryKey: ["nutrition", "state"], queryFn: nutritionApi.state });

/** Settings › Nutrition: the profile the target comes from, and the target itself. */
export function NutritionSettingsPanel() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const state = useNutritionState();
  const [draft, setDraft] = useState<ProfileFields | null>(null);
  const save = useMutation({
    mutationFn: (profile: ProfileFields) => nutritionApi.saveProfile(profile),
    onSuccess: async () => {
      setDraft(null);
      await client.invalidateQueries({ queryKey: ["nutrition"] });
      toast.success("Saved. Recalculate your target to use the new numbers.");
    },
  });
  const recalculate = () => navigate("/nutrition?setup=1");
  const profile = draft ?? state.data?.profile ?? null;
  const target = state.data?.target;
  const change = (values: Partial<ProfileFields>) =>
    profile && setDraft({ ...profile, ...values });
  const ai = useAiPreferences();
  const enabled = ai.query.data?.nutrition !== false;
  return (
    <section className="settings-panel nutrition-settings">
      <h2>Nutrition</h2>
      {!enabled ? null : (
        <>
          <p>
            What your daily target is worked out from. Changing these doesn't
            change the target until you recalculate it.
          </p>
          <p className="settings-hint">
            ChatGPT sees your profile and training summary only while working
            out a target, and a meal's photos and description only while
            estimating it. Everything else stays on your server.
          </p>
          {ai.query.data && (
            <div className="nutrition-enable">
              <Switch
                label="Use Nutrition"
                hint="Shows Nutrition in the sidebar and lets the assistant see and log meals. Turning it off keeps everything you logged."
                checked={enabled}
                onChange={(nutrition) =>
                  ai.save.mutate({ ...ai.query.data!, nutrition })
                }
              />
            </div>
          )}
          {state.isError && <Notice tone="error">{state.error.message}</Notice>}
          {state.data && !profile && (
            <div className="nutrition-settings-empty">
              <p>Nutrition isn't set up yet.</p>
              <Button onClick={recalculate}>Set up Nutrition</Button>
            </div>
          )}
          {profile && (
            <form
              className="nutrition-profile-form"
              onSubmit={(event) => {
                event.preventDefault();
                save.mutate(profile);
              }}
            >
              <label>
                Age
                <input
                  type="number"
                  min={13}
                  max={110}
                  value={profile.age}
                  onChange={(event) =>
                    change({ age: Number(event.target.value) })
                  }
                />
              </label>
              <label>
                Sex, for the formula
                <select
                  value={profile.sex}
                  onChange={(event) =>
                    change({ sex: event.target.value as ProfileFields["sex"] })
                  }
                >
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="unspecified">Prefer not to say</option>
                </select>
              </label>
              <label>
                Height (cm)
                <input
                  type="number"
                  min={100}
                  max={250}
                  value={profile.height_cm}
                  onChange={(event) =>
                    change({ height_cm: Number(event.target.value) })
                  }
                />
              </label>
              <label>
                Weight (kg)
                <input
                  type="number"
                  min={30}
                  max={300}
                  step={0.1}
                  value={profile.weight_kg}
                  onChange={(event) =>
                    change({ weight_kg: Number(event.target.value) })
                  }
                />
              </label>
              <label>
                Activity
                <select
                  value={profile.activity}
                  onChange={(event) =>
                    change({
                      activity: event.target.value as ProfileFields["activity"],
                    })
                  }
                >
                  {ACTIVITIES.map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Pace
                <select
                  value={profile.pace}
                  onChange={(event) =>
                    change({
                      pace: event.target.value as ProfileFields["pace"],
                    })
                  }
                >
                  <option value="gentle">Gentle</option>
                  <option value="standard">Standard</option>
                </select>
              </label>
              <label className="wide">
                Your goal
                <textarea
                  rows={2}
                  maxLength={300}
                  value={profile.goal}
                  onChange={(event) => change({ goal: event.target.value })}
                />
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={profile.read_training}
                  onChange={(event) =>
                    change({ read_training: event.target.checked })
                  }
                />
                Look at my tracked time and habits to see how I train
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={profile.pregnant}
                  onChange={(event) =>
                    change({ pregnant: event.target.checked })
                  }
                />
                Pregnant or breastfeeding
              </label>
              {save.error && <Notice tone="error">{save.error.message}</Notice>}
              <div className="nutrition-settings-actions">
                <Button
                  type="submit"
                  variant="secondary"
                  disabled={!draft || save.isPending}
                >
                  {save.isPending ? "Saving…" : "Save"}
                </Button>
                {draft && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setDraft(null)}
                  >
                    Undo changes
                  </Button>
                )}
              </div>
            </form>
          )}
          {target && (
            <section className="nutrition-settings-target">
              <h3>Your target</h3>
              <p>
                <strong>{kcal(target.kcal)} kcal</strong> · {target.protein} g
                protein · {target.carbs} g carbs · {target.fat} g fat
              </p>
              <small>
                Maintenance {kcal(target.maintenance)} kcal (
                {kcal(target.resting)} resting) · in force since{" "}
                {dayLabel(target.starts_on, {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </small>
              {target.explanation && (
                <p className="settings-hint">{target.explanation}</p>
              )}
              <AiSources sources={target.sources} />
              <Button variant="secondary" onClick={recalculate}>
                Recalculate target
              </Button>
            </section>
          )}
        </>
      )}
    </section>
  );
}

const MACROS = [
  ["kcal", "kcal"],
  ["protein", "Protein g"],
  ["carbs", "Carbs g"],
  ["fat", "Fat g"],
] as const;

const blankItem = (): MealItem => ({
  name: "",
  amount: "",
  kcal: 0,
  protein: 0,
  carbs: 0,
  fat: 0,
  confidence: "high",
});

/** Settings › Saved meals: the meals you log again, to browse, correct or remove. */
export function SavedMealsPanel() {
  const client = useQueryClient();
  const state = useNutritionState();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<{
    name: string;
    items: MealItem[];
  } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const meals = useMemo(() => state.data?.saved_meals ?? [], [state.data]);
  const shown = useMemo(
    () =>
      meals.filter((meal) =>
        `${meal.name} ${meal.items.map((item) => item.name).join(" ")}`
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
      ),
    [meals, query],
  );
  const current: SavedMeal | null =
    meals.find((meal) => meal.id === selected) ?? null;
  const open = (meal: SavedMeal | "new") => {
    setSelected(meal === "new" ? "new" : meal.id);
    setDraft(
      meal === "new"
        ? { name: "", items: [blankItem()] }
        : { name: meal.name, items: meal.items },
    );
  };
  const refresh = () => client.invalidateQueries({ queryKey: ["nutrition"] });
  const save = useMutation({
    mutationFn: () =>
      selected === "new" || !current
        ? nutritionApi.addSaved(draft!.name.trim(), draft!.items)
        : nutritionApi.editSaved(current.id, {
            name: draft!.name.trim(),
            items: draft!.items,
            revision: current.revision,
          }),
    onSuccess: async (meal) => {
      await refresh();
      setSelected(meal.id);
      toast.success("Saved meal updated");
    },
  });
  const remove = useMutation({
    mutationFn: () => nutritionApi.removeSaved(current!.id),
    onSuccess: async () => {
      setDeleting(false);
      setSelected(null);
      setDraft(null);
      await refresh();
    },
    onError: (error) => toast.error(error.message),
  });
  const setItem = (index: number, values: Partial<MealItem>) =>
    setDraft(
      (before) =>
        before && {
          ...before,
          items: before.items.map((item, at) =>
            at === index ? { ...item, ...values } : item,
          ),
        },
    );
  const valid =
    draft &&
    draft.name.trim() &&
    draft.items.length &&
    draft.items.every((item) => item.name.trim());

  return (
    <section className="settings-panel saved-meals">
      <div className="saved-meals-heading">
        <h2>Saved meals</h2>
        <Button variant="secondary" size="small" onClick={() => open("new")}>
          <Plus size={14} />
          New saved meal
        </Button>
      </div>
      <p>
        Meals you log again in one tap, without asking AI. Tick “Remember as a
        saved meal” when you save a meal to add it here.
      </p>
      {state.isError && <Notice tone="error">{state.error.message}</Notice>}
      <div className="saved-meals-layout">
        <div className="saved-meals-list">
          <label className="saved-meals-search">
            <Search size={14} />
            <input
              aria-label="Search saved meals"
              placeholder="Search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          {shown.map((meal) => (
            <button
              key={meal.id}
              type="button"
              aria-current={selected === meal.id ? "true" : undefined}
              onClick={() => open(meal)}
            >
              <Bookmark size={14} />
              <span>
                <strong>{meal.name}</strong>
                <small>
                  {kcal(totals(meal.items).kcal)} kcal · used {meal.uses} time
                  {meal.uses === 1 ? "" : "s"}
                </small>
              </span>
            </button>
          ))}
          {state.data && !meals.length && (
            <p className="settings-hint">No saved meals yet.</p>
          )}
          {meals.length > 0 && !shown.length && (
            <p className="settings-hint">Nothing matches “{query}”.</p>
          )}
        </div>
        {draft && (
          <form
            className="saved-meal-editor"
            onSubmit={(event) => {
              event.preventDefault();
              if (valid) save.mutate();
            }}
          >
            <label>
              Name
              <input
                value={draft.name}
                maxLength={80}
                onChange={(event) =>
                  setDraft({ ...draft, name: event.target.value })
                }
              />
            </label>
            <div className="saved-meal-items">
              {draft.items.map((item, index) => (
                <div key={index} className="saved-meal-row">
                  <input
                    className="saved-meal-name"
                    aria-label="Item"
                    placeholder="Item"
                    value={item.name}
                    onChange={(event) =>
                      setItem(index, { name: event.target.value })
                    }
                  />
                  <label className="saved-meal-amount">
                    Amount
                    <input
                      value={item.amount}
                      placeholder="1 bowl"
                      onChange={(event) =>
                        setItem(index, { amount: event.target.value })
                      }
                    />
                  </label>
                  {MACROS.map(([key, label]) => (
                    <label key={key}>
                      {label}
                      <input
                        type="number"
                        min={0}
                        inputMode="decimal"
                        value={item[key]}
                        onChange={(event) =>
                          setItem(index, {
                            [key]: Math.max(0, Number(event.target.value) || 0),
                          })
                        }
                      />
                    </label>
                  ))}
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Remove ${item.name || "item"}`}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        items: draft.items.filter((_, at) => at !== index),
                      })
                    }
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
              <Button
                type="button"
                variant="ghost"
                size="small"
                onClick={() =>
                  setDraft({ ...draft, items: [...draft.items, blankItem()] })
                }
              >
                <Plus size={14} />
                Add item
              </Button>
            </div>
            <p className="settings-hint">
              {kcal(totals(draft.items).kcal)} kcal ·{" "}
              {Math.round(totals(draft.items).protein)} g protein
            </p>
            {save.error && <Notice tone="error">{save.error.message}</Notice>}
            <div className="nutrition-settings-actions">
              {current && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setDeleting(true)}
                >
                  <Trash2 size={14} />
                  Delete
                </Button>
              )}
              <span className="spacer" />
              <Button type="submit" disabled={!valid || save.isPending}>
                {save.isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          </form>
        )}
      </div>
      <ConfirmDialog
        open={deleting}
        pending={remove.isPending}
        title={`Delete ${current?.name ?? "saved meal"}?`}
        description="Meals you already logged with it stay in your log."
        keepLabel="Keep it"
        confirmLabel="Delete"
        onClose={() => setDeleting(false)}
        onConfirm={() => remove.mutate()}
      />
    </section>
  );
}
