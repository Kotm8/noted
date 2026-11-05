import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import {
  Apple,
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  Menu,
  Settings2,
  Sparkles,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import { Notice } from "../../components/ui/notice";
import { liveInterval } from "../../lib/live";
import { useAiStatus } from "../ai/queries";
import { addDays, dayLabel, weekDays, zonedParts } from "../schedule/dates";
import { useWorkspaceShell } from "../workspaces/shell-context";
import { nutritionApi } from "./api";
import { LogDock } from "./log-dock";
import { MealCard } from "./meal-card";
import { MacroBars, Ring } from "./parts";
import { NutritionSetup } from "./setup";
import { SidePanels } from "./side-panels";
import { SLOTS, kcal, totals } from "./types";

export function NutritionPage() {
  const shell = useWorkspaceShell();
  const status = useAiStatus();
  const state = useQuery({
    queryKey: ["nutrition", "state"],
    queryFn: nutritionApi.state,
    refetchInterval: () => liveInterval(60000),
  });
  const [day, setDay] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  const [setup, setSetup] = useState(false);
  // Settings › Nutrition sends people here with ?setup=1 to recalculate.
  useEffect(() => {
    if (!params.get("setup")) return;
    setSetup(true);
    setParams({}, { replace: true });
  }, [params, setParams]);
  const [open, setOpen] = useState<string | null>(null);
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  const today = state.data?.today ?? "";
  const shown = day ?? today;
  const week = shown ? weekDays(shown) : [];
  const meals = useQuery({
    queryKey: ["nutrition", "meals", shown],
    queryFn: () => nutritionApi.meals(shown, shown),
    enabled: Boolean(shown && state.data?.target),
  });
  const days = useQuery({
    queryKey: ["nutrition", "days", week[0], week[6]],
    queryFn: () => nutritionApi.days(week[0], week[6]),
    enabled: Boolean(week.length && state.data?.target),
  });
  const nowMinute = state.data
    ? zonedParts(clock, state.data.timezone).minute
    : 0;

  const header = (
    <header className="channel-header">
      <button
        className="icon-button mobile-menu"
        aria-label="Open navigation"
        onClick={shell.openNavigation}
      >
        <Menu size={20} />
      </button>
      <div className="channel-heading">
        <Apple size={18} />
        <h1>Nutrition</h1>
        {shown && !setup && state.data?.target && (
          <span className="nutrition-subtitle">
            {dayLabel(shown, {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
          </span>
        )}
      </div>
      {status.data?.connected && state.data?.target && !setup && (
        <>
          <Button
            variant="ghost"
            size="small"
            onClick={() =>
              window.dispatchEvent(new Event("noted:assistant-open"))
            }
          >
            <Sparkles size={15} />
            Ask AI
          </Button>
          <button
            className="icon-button"
            aria-label="Targets and profile"
            title="Targets and profile"
            onClick={() => setSetup(true)}
          >
            <Settings2 size={17} />
          </button>
        </>
      )}
    </header>
  );

  if (status.data && !status.data.connected)
    return (
      <>
        {header}
        <div className="nutrition-scroll">
          <div className="nutrition-connect">
            <span className="connect-mark">
              <Apple size={20} />
            </span>
            <h2>Nutrition needs AI</h2>
            <p>
              It estimates meals from photos and descriptions, and works out
              your target, with your own ChatGPT plan. Connect it in Settings ›
              AI. Anything you logged before stays here.
            </p>
            <Button
              onClick={() =>
                window.dispatchEvent(new Event("noted:ai-settings"))
              }
            >
              Open AI settings
            </Button>
          </div>
        </div>
      </>
    );
  if (state.isError)
    return (
      <>
        {header}
        <div className="nutrition-scroll">
          <Notice tone="error">
            {state.error.message}
            <Button
              variant="ghost"
              size="small"
              onClick={() => void state.refetch()}
            >
              Retry
            </Button>
          </Notice>
        </div>
      </>
    );
  if (!state.data || !status.data)
    return (
      <>
        {header}
        <div className="nutrition-loading">
          <LoaderCircle size={20} className="spin" />
        </div>
      </>
    );
  const data = state.data;
  if (setup || !data.profile || !data.target)
    return (
      <>
        {header}
        <div className="nutrition-scroll">
          <NutritionSetup
            initial={data.profile}
            onDone={() => setSetup(false)}
            onCancel={data.target ? () => setSetup(false) : undefined}
          />
        </div>
      </>
    );

  const target = data.target;
  const list = meals.data ?? [];
  const eaten = totals(list.flatMap((meal) => meal.items));
  return (
    <>
      {header}
      <div className="nutrition-scroll">
        <div className="nutrition-layout">
          <div className="nutrition-main">
            <div className="nutrition-day-nav">
              <button
                className="icon-button"
                aria-label="Previous day"
                onClick={() => setDay(addDays(shown, -1))}
              >
                <ChevronLeft size={17} />
              </button>
              <button
                className="icon-button"
                aria-label="Next day"
                disabled={shown >= today}
                onClick={() => setDay(addDays(shown, 1))}
              >
                <ChevronRight size={17} />
              </button>
              {shown !== today && (
                <Button
                  variant="ghost"
                  size="small"
                  onClick={() => setDay(null)}
                >
                  Today
                </Button>
              )}
            </div>
            <div className="nutrition-summary">
              <Ring eaten={eaten.kcal} target={target.kcal} />
              <div className="summary-text">
                <h2>
                  {shown === today
                    ? "Today"
                    : dayLabel(shown, { weekday: "long" })}
                </h2>
                <p>
                  <strong>{kcal(eaten.kcal)}</strong> eaten of{" "}
                  {kcal(target.kcal)} kcal
                </p>
                <MacroBars eaten={eaten} target={target} />
              </div>
            </div>
            {meals.isError && (
              <Notice tone="error">{meals.error.message}</Notice>
            )}
            <div className="nutrition-slots">
              {SLOTS.map((slot) => {
                const inSlot = list.filter((meal) => meal.slot === slot);
                return (
                  <section key={slot} className="nutrition-slot">
                    <div className="slot-head">
                      <h3>{slot === "Snack" ? "Snacks" : slot}</h3>
                      {inSlot.length > 0 && (
                        <small>
                          {kcal(
                            totals(inSlot.flatMap((meal) => meal.items)).kcal,
                          )}{" "}
                          kcal
                        </small>
                      )}
                    </div>
                    {inSlot.length ? (
                      inSlot.map((meal) => (
                        <MealCard
                          key={meal.id}
                          meal={meal}
                          open={open === meal.id}
                          onToggle={() =>
                            setOpen(open === meal.id ? null : meal.id)
                          }
                          savedNames={data.saved_meals.map((item) => item.name)}
                          logDay={today}
                          nowMinute={nowMinute}
                        />
                      ))
                    ) : (
                      <p className="slot-empty">Nothing yet</p>
                    )}
                  </section>
                );
              })}
            </div>
          </div>
          <SidePanels
            state={data}
            week={days.data ?? []}
            onRecalculate={() => setSetup(true)}
          />
        </div>
      </div>
      <LogDock state={data} day={shown} nowMinute={nowMinute} />
    </>
  );
}
