import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Camera, ChevronRight, Plus, Utensils } from "lucide-react";
import { Modal } from "../../../components/ui/dialog";
import { Notice } from "../../../components/ui/notice";
import { liveInterval } from "../../../lib/live";
import { useNutritionEnabled } from "../../ai/queries";
import { nutritionApi } from "../../nutrition/api";
import { LogDock } from "../../nutrition/log-dock";
import { MealPhoto, Ring } from "../../nutrition/parts";
import { kcal, SLOTS, totals } from "../../nutrition/types";
import { addDays, minuteLabel, zonedParts } from "../../schedule/dates";

export function HomeFood({
  today,
  timezone,
  now,
  onOpen,
}: {
  today: string;
  timezone: string;
  now: number;
  onOpen: () => void;
}) {
  const enabled = useNutritionEnabled();
  const [logging, setLogging] = useState(false);
  const state = useQuery({
    queryKey: ["nutrition", "state"],
    queryFn: nutritionApi.state,
    enabled,
    refetchInterval: () => liveInterval(60000),
  });
  const day = state.data?.today ?? today;
  const meals = useQuery({
    queryKey: ["nutrition", "meals", day],
    queryFn: () => nutritionApi.meals(day, day),
    enabled: enabled && Boolean(state.data?.target),
    refetchInterval: () => liveInterval(30000),
  });
  const days = useQuery({
    queryKey: ["nutrition", "days", addDays(day, -6), day],
    queryFn: () => nutritionApi.days(addDays(day, -6), day),
    enabled: enabled && Boolean(state.data?.target),
    refetchInterval: () => liveInterval(60000),
  });
  const list = meals.data ?? [];
  const eaten = totals(list.flatMap((meal) => meal.items));
  const target = state.data?.target;
  const missing = SLOTS.filter(
    (slot) => slot !== "Snack" && !list.some((meal) => meal.slot === slot),
  )[0];
  const average = days.data?.length
    ? days.data.reduce((sum, item) => sum + item.kcal, 0) / days.data.length
    : null;
  if (!enabled) return null;
  return (
    <section className="home-b-section home-b-food" aria-label="Food summary">
      <div className="home-b-section-heading">
        <h2>Food</h2>
        <div>
          {enabled && target && (
            <button
              className="home-small-button"
              onClick={() => setLogging(true)}
            >
              <Camera size={13} />
              Log meal
            </button>
          )}
          <button className="home-text-button" onClick={onOpen}>
            Nutrition
            <ChevronRight size={13} />
          </button>
        </div>
      </div>
      {state.isPending ? (
        <p className="home-empty">Loading food…</p>
      ) : state.error || meals.error ? (
        <Notice tone="error">
          {(state.error ?? meals.error)?.message}
          <button
            onClick={() => {
              void state.refetch();
              void meals.refetch();
            }}
          >
            Retry
          </button>
        </Notice>
      ) : !target ? (
        <p className="home-empty">
          Set your nutrition target to see your day here.{" "}
          <button className="home-text-button" onClick={onOpen}>
            Set up nutrition
          </button>
        </p>
      ) : (
        <>
          <div className="home-food-overview">
            <Ring eaten={eaten.kcal} target={target.kcal} size={76} />
            <div className="home-food-macros">
              {(["protein", "carbs", "fat"] as const).map((key) => (
                <div key={key} className={key}>
                  <span>{key[0].toUpperCase() + key.slice(1)}</span>
                  <small>
                    {Math.round(eaten[key])} / {target[key]} g
                  </small>
                  <span className="home-macro-track">
                    <i
                      style={{
                        width: `${Math.min(100, (eaten[key] / Math.max(1, target[key])) * 100)}%`,
                      }}
                    />
                  </span>
                </div>
              ))}
            </div>
          </div>
          {list.map((meal) => (
            <button className="home-meal-row" key={meal.id} onClick={onOpen}>
              {meal.photo_ids[0] ? (
                <MealPhoto id={meal.photo_ids[0]} size={28} />
              ) : (
                <span className="home-meal-placeholder">
                  <Utensils size={13} />
                </span>
              )}
              <small>{meal.slot}</small>
              <span>{meal.name}</span>
              <time>{minuteLabel(meal.minute)}</time>
              <strong>{kcal(totals(meal.items).kcal)}</strong>
            </button>
          ))}
          {missing && (
            <button
              className="home-meal-row home-meal-empty"
              onClick={() => setLogging(true)}
            >
              <span className="home-meal-placeholder">
                <Plus size={13} />
              </span>
              <small>{missing}</small>
              <span>Not logged yet</span>
            </button>
          )}
          <div className="home-food-footer">
            <span>
              {kcal(eaten.kcal)} of {kcal(target.kcal)} kcal eaten
            </span>
            {average !== null && <span>Week avg {kcal(average)}</span>}
          </div>
        </>
      )}
      {logging && state.data && (
        <Modal
          open
          title="Log meal"
          description={day}
          className="home-meal-dialog"
          onOpenChange={setLogging}
        >
          <LogDock
            state={state.data}
            day={day}
            nowMinute={zonedParts(now, state.data.timezone ?? timezone).minute}
          />
        </Modal>
      )}
    </section>
  );
}
