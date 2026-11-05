import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Scale } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../../components/ui/button";
import { addDays, dayLabel } from "../schedule/dates";
import { nutritionApi } from "./api";
import { kcal, trend, type DaySummary, type NutritionState } from "./types";

const CHART = 100;

function WeekChart({
  days,
  today,
  target,
}: {
  days: DaySummary[];
  today: string;
  target: number;
}) {
  const max = Math.max(target * 1.25, ...days.map((day) => day.kcal));
  return (
    <div className="week-chart">
      <div className="chart-bars" style={{ height: CHART + 18 }}>
        {days.map((day) => (
          <div
            key={day.day}
            className={`chart-day${day.day === today ? " today" : ""}`}
            title={`${dayLabel(day.day)}: ${kcal(day.kcal)} kcal`}
          >
            <span className="bar-area" style={{ height: CHART }}>
              <span
                className={`bar${day.target && day.kcal > day.target + 150 ? " over" : ""}`}
                style={{
                  height: day.day > today ? 0 : (day.kcal / max) * CHART,
                }}
              />
            </span>
            <small>{dayLabel(day.day, { weekday: "short" })}</small>
          </div>
        ))}
        <span
          className="target-line"
          style={{ bottom: 18 + (target / max) * CHART }}
        >
          <small>{kcal(target)}</small>
        </span>
      </div>
    </div>
  );
}

function WeightChart({ points }: { points: NutritionState["weigh_ins"] }) {
  if (points.length < 2) return null;
  const values = points.map((point) => point.weight_kg);
  const smooth = trend(points);
  const min = Math.min(...values) - 0.3;
  const max = Math.max(...values) + 0.3;
  const x = (index: number) => 8 + (index / (values.length - 1)) * 184;
  const y = (value: number) => 62 - ((value - min) / (max - min)) * 54;
  return (
    <svg
      className="weight-chart"
      viewBox="0 0 200 70"
      role="img"
      aria-label="Weight trend"
    >
      {values.map((value, index) => (
        <circle
          key={points[index].day}
          cx={x(index)}
          cy={y(value)}
          r={2.2}
          className="weigh-in"
        />
      ))}
      <polyline
        points={smooth
          .map((value, index) => `${x(index)},${y(value)}`)
          .join(" ")}
        className="trend-line"
      />
    </svg>
  );
}

export function SidePanels({
  state,
  week,
  onRecalculate,
}: {
  state: NutritionState;
  week: DaySummary[];
  onRecalculate: () => void;
}) {
  const client = useQueryClient();
  const [weighing, setWeighing] = useState(false);
  const [value, setValue] = useState("");
  const target = state.target!;
  const logged = week.filter((day) => day.day <= state.today && day.meals > 0);
  const average = logged.length
    ? logged.reduce((sum, day) => sum + day.kcal, 0) / logged.length
    : 0;
  const recent = state.weigh_ins.slice(-30);
  const smooth = trend(recent);
  const latest = recent.at(-1);
  const twoWeeks = recent.filter(
    (point) => point.day >= addDays(state.today, -14),
  );
  const change =
    twoWeeks.length >= 2 ? trend(twoWeeks).at(-1)! - trend(twoWeeks)[0] : null;
  const weigh = useMutation({
    mutationFn: () =>
      nutritionApi.weighIn(state.today, Number(value.replace(",", "."))),
    onSuccess: async () => {
      setWeighing(false);
      setValue("");
      await client.invalidateQueries({ queryKey: ["nutrition"] });
    },
    onError: (error) => toast.error(error.message),
  });
  return (
    <aside className="nutrition-side">
      <section>
        <div className="side-head">
          <h3>This week</h3>
          {logged.length > 0 && <small>Avg {kcal(average)} kcal</small>}
        </div>
        <WeekChart days={week} today={state.today} target={target.kcal} />
      </section>
      <section>
        <div className="side-head">
          <h3>Weight</h3>
          <Button
            variant="ghost"
            size="small"
            onClick={() => setWeighing(!weighing)}
          >
            <Scale size={14} />
            Log weight
          </Button>
        </div>
        {weighing && (
          <form
            className="weigh-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (Number(value.replace(",", ".")) >= 30) weigh.mutate();
            }}
          >
            <input
              autoFocus
              inputMode="decimal"
              aria-label="Today's weight in kg"
              placeholder={latest ? String(latest.weight_kg) : "kg"}
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
            <small>kg today</small>
            <Button size="small" type="submit" disabled={weigh.isPending}>
              Save
            </Button>
          </form>
        )}
        {latest ? (
          <>
            <div className="weight-now">
              <strong>{smooth.at(-1)!.toFixed(1)} kg</strong>
              <small>
                {change === null
                  ? `Last weighed ${dayLabel(latest.day, { day: "numeric", month: "short" })}`
                  : `Trend ${change > 0 ? "+" : change < 0 ? "−" : ""}${Math.abs(change).toFixed(1)} kg in two weeks`}
              </small>
            </div>
            <WeightChart points={recent} />
          </>
        ) : (
          <p className="side-empty">
            Weigh in now and then to see your trend. Daily swings are smoothed
            out.
          </p>
        )}
      </section>
      <section className="target-summary">
        <div className="side-head">
          <h3>Your target</h3>
          <Button variant="ghost" size="small" onClick={onRecalculate}>
            Recalculate
          </Button>
        </div>
        <p>
          <strong>{kcal(target.kcal)} kcal</strong> · {target.protein} g protein
        </p>
        <small>
          Maintenance {kcal(target.maintenance)} · set{" "}
          {dayLabel(target.starts_on, { day: "numeric", month: "long" })}
        </small>
      </section>
    </aside>
  );
}
