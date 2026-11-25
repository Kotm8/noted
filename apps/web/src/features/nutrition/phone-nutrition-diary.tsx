import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Camera } from "lucide-react";
import { Button } from "../../components/ui/button";
import { DatePicker } from "../../components/ui/date-picker";
import { Modal } from "../../components/ui/dialog";
import { Notice } from "../../components/ui/notice";
import { dayLabel } from "../schedule/dates";
import { nutritionApi } from "./api";
import { LogMealDialog } from "./log-meal-dialog";
import { MealCard } from "./meal-card";
import { MealEditor, type MealDraft } from "./meal-editor";
import { MacroBars, Ring } from "./parts";
import { SidePanels } from "./side-panels";
import {
  kcal,
  slotFor,
  totals,
  type DaySummary,
  type Meal,
  type NutritionState,
  type Target,
} from "./types";
import "./phone-nutrition.css";

export function PhoneNutritionDiary({
  day,
  setDay,
  state,
  target,
  meals,
  mealsError,
  retryMeals,
  week,
  nowMinute,
  logRequested,
  sharedCapture,
  closeRequestedLog,
  onRecalculate,
}: {
  day: string;
  setDay: (day: string) => void;
  state: NutritionState;
  target: Target;
  meals?: Meal[];
  mealsError: Error | null;
  retryMeals: () => void;
  week: DaySummary[];
  nowMinute: number;
  logRequested: boolean;
  sharedCapture?: string;
  closeRequestedLog: () => void;
  onRecalculate: () => void;
}) {
  const [openMeal, setOpenMeal] = useState<string | null>(null);
  const [entry, setEntry] = useState<"log" | "manual" | null>(null);
  const shownToday = day === state.today;
  const date = dayLabel(day, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const eaten = meals && totals(meals.flatMap((meal) => meal.items));
  const remaining = eaten ? target.kcal - eaten.kcal : 0;
  const names = state.saved_meals.map((meal) => meal.name);

  return (
    <div className="phone-nutrition-diary">
      <div className="phone-nutrition-date">
        <DatePicker
          value={day}
          maxDate={state.today}
          displayLabel={shownToday ? `Today · ${date}` : date}
          label="Choose food diary date"
          onChange={setDay}
        />
        {!shownToday && (
          <Button variant="ghost" onClick={() => setDay(state.today)}>
            Today
          </Button>
        )}
      </div>
      {mealsError && (
        <Notice tone="error">
          {mealsError.message}
          <Button variant="ghost" size="small" onClick={retryMeals}>
            Retry
          </Button>
        </Notice>
      )}
      {!meals && !mealsError && (
        <p className="phone-nutrition-empty" role="status">
          Loading diary…
        </p>
      )}
      {eaten && (
        <section
          className="phone-nutrition-progress"
          aria-label="Calories and macros"
        >
          <div className="phone-nutrition-calories">
            <Ring
              eaten={eaten.kcal}
              target={target.kcal}
              size={114}
              showEaten
            />
            <div className="phone-nutrition-remaining">
              <span>
                {remaining < 0
                  ? "Over target"
                  : shownToday
                    ? "Left today"
                    : "Below target"}
              </span>
              <strong>
                {kcal(Math.abs(remaining))} <small>kcal</small>
              </strong>
            </div>
          </div>
          <MacroBars eaten={eaten} target={target} />
        </section>
      )}
      <section
        className="phone-nutrition-meals"
        aria-labelledby="phone-nutrition-meals"
      >
        <h2 id="phone-nutrition-meals">Meals</h2>
        {meals?.length === 0 && (
          <p className="phone-nutrition-empty">No meals logged for this day.</p>
        )}
        {meals &&
          [...meals]
            .sort((a, b) => a.minute - b.minute)
            .map((meal) => (
              <MealCard
                key={meal.id}
                meal={meal}
                compact
                open={openMeal === meal.id}
                onToggle={() =>
                  setOpenMeal(openMeal === meal.id ? null : meal.id)
                }
                savedNames={names}
                logDay={state.today}
                nowMinute={nowMinute}
              />
            ))}
        <div className="phone-nutrition-entry">
          <Button onClick={() => setEntry("log")}>
            <Camera size={18} /> Log meal
          </Button>
          <Button variant="ghost" onClick={() => setEntry("manual")}>
            Add a meal by hand
          </Button>
        </div>
      </section>
      <SidePanels state={state} week={week} onRecalculate={onRecalculate} />
      {(entry === "log" || logRequested) && (
        <LogMealDialog
          state={state}
          day={day}
          label={date}
          minute={nowMinute}
          className="phone-nutrition-sheet"
          sharedCapture={sharedCapture}
          close={() => {
            setEntry(null);
            if (logRequested) closeRequestedLog();
          }}
        />
      )}
      {entry === "manual" && (
        <ManualMeal
          day={day}
          date={date}
          minute={nowMinute}
          close={() => setEntry(null)}
        />
      )}
    </div>
  );
}

function ManualMeal({
  day,
  date,
  minute,
  close,
}: {
  day: string;
  date: string;
  minute: number;
  close: () => void;
}) {
  const client = useQueryClient();
  const save = useMutation({
    mutationFn: ({
      draft,
      remember,
    }: {
      draft: MealDraft;
      remember: boolean;
    }) =>
      nutritionApi.addMeal({
        ...draft,
        day,
        source: "manual",
        saved_meal_id: null,
        remember,
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["nutrition"] });
      close();
    },
  });
  return (
    <Modal
      open
      title="Add a meal by hand"
      description={date}
      className="phone-nutrition-sheet"
      onOpenChange={(open) => {
        if (!open && !save.isPending) close();
      }}
    >
      <MealEditor
        manual
        initial={{
          name: "",
          slot: slotFor(minute),
          minute,
          photo_ids: [],
          items: [
            {
              name: "",
              amount: "",
              kcal: 0,
              protein: 0,
              carbs: 0,
              fat: 0,
              confidence: "high",
            },
          ],
        }}
        rememberable
        saving={save.isPending}
        error={save.error?.message}
        onSave={(draft, remember) => save.mutate({ draft, remember })}
        onDiscard={close}
      />
    </Modal>
  );
}
