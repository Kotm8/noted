import { scaleItem, totals, type MealItem } from "../types";

export function portionGrams(items: MealItem[]): number | null {
  const grams = items.map((item) => {
    if (item.grams && item.grams > 0) return item.grams;
    const match = /^\s*(\d+(?:\.\d+)?)\s*(g|kg)\s*$/i.exec(item.amount);
    return match
      ? Number(match[1]) * (match[2].toLowerCase() === "kg" ? 1000 : 1)
      : null;
  });
  return grams.every((value) => value !== null && value > 0)
    ? grams.reduce<number>((sum, value) => sum + (value ?? 0), 0)
    : null;
}

export function scaledItems(items: MealItem[], factor: number): MealItem[] {
  return items.map((item) => {
    const scaled = scaleItem(item, factor);
    const grams = portionGrams([item]);
    return grams
      ? {
          ...scaled,
          grams: Math.round(grams * factor * 10) / 10,
          amount: `${Math.round(grams * factor * 10) / 10} g`,
        }
      : scaled;
  });
}

export function portionLabel(items: MealItem[]): string {
  const grams = portionGrams(items);
  return grams
    ? `${grams} g`
    : items.length === 1
      ? items[0].amount || "1 portion"
      : `${items.length} items`;
}

export const macroSummary = (items: MealItem[]) => {
  const value = totals(items);
  return `${Math.round(value.protein * 10) / 10} g protein · ${Math.round(value.carbs * 10) / 10} g carbs · ${Math.round(value.fat * 10) / 10} g fat`;
};
