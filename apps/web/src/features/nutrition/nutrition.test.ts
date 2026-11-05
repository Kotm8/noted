import { describe, expect, it } from "vitest";
import { scaleItem, slotFor, totals, trend, type MealItem } from "./types";
import { applyEvent, type RunState } from "./use-nutrition-run";

const potatoes: MealItem = {
  name: "Roast potatoes",
  amount: "200 g",
  grams: 200,
  kcal: 260,
  protein: 5,
  carbs: 40,
  fat: 9,
  confidence: "medium",
};

describe("nutrition maths", () => {
  it("scales calories and macros together and says how much", () => {
    const more = scaleItem(potatoes, 1.25);
    expect(more).toMatchObject({
      kcal: 325,
      protein: 6.3,
      carbs: 50,
      fat: 11.3,
      grams: 250,
    });
    expect(more.amount).toBe("125% of 200 g");
    expect(scaleItem(potatoes, 1)).toEqual(potatoes);
  });

  it("adds up a meal", () => {
    expect(totals([potatoes, scaleItem(potatoes, 0.5)])).toMatchObject({
      kcal: 390,
      carbs: 60,
    });
  });

  it("picks the meal from the local time", () => {
    expect([
      slotFor(8 * 60),
      slotFor(13 * 60),
      slotFor(16 * 60 + 30),
      slotFor(19 * 60),
      slotFor(23 * 60),
    ]).toEqual(["Breakfast", "Lunch", "Snack", "Dinner", "Snack"]);
  });

  it("smooths weigh-ins over the last four", () => {
    const points = [83, 82, 84, 81, 82].map((weight_kg, index) => ({
      day: `2026-11-0${index + 1}`,
      weight_kg,
    }));
    expect(trend(points).map((value) => Math.round(value * 100) / 100)).toEqual(
      [83, 82.5, 83, 82.5, 82.25],
    );
  });
});

describe("estimate stream", () => {
  const start: RunState<unknown> = {
    stage: "idle",
    heading: "",
    query: "",
    items: [],
    output: null,
    sources: [],
    thoughtSeconds: null,
    searched: false,
    error: null,
    code: null,
  };

  it("moves from thinking to searching to writing, and reports errors", () => {
    let state = applyEvent(start, {
      type: "start",
      run_id: null,
      model: "gpt-6.1-sol",
    });
    expect(state.stage).toBe("thinking");
    state = applyEvent(state, { type: "search", query: "salmon calories" });
    expect(state).toMatchObject({
      stage: "searching",
      searched: true,
      query: "salmon calories",
    });
    state = applyEvent(state, {
      type: "items",
      items: [potatoes],
      thought_seconds: 2,
    });
    expect(state).toMatchObject({ stage: "writing", thoughtSeconds: 2 });
    // A late thinking heading doesn't take writing back to thinking.
    expect(
      applyEvent(state, { type: "thinking", heading: "Checking" }).stage,
    ).toBe("writing");
    state = applyEvent(state, {
      type: "error",
      code: "limit",
      message: "Limit reached",
    });
    expect(state).toMatchObject({ stage: "error", code: "limit" });
  });
});
