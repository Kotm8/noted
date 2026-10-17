import { useState } from "react";
import { readStoredValue, writeStoredValue } from "../../../lib/storage";

function readCollapsedCategories(): Set<string> {
  try {
    const value: unknown = JSON.parse(readStoredValue("noted.collapsed") ?? "[]");
    if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
      return new Set(value);
    }
  } catch {
    return new Set();
  }
  return new Set();
}

export function useCategoryCollapse() {
  const [collapsed, setCollapsed] = useState(readCollapsedCategories);

  function toggleCategory(categoryId: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(categoryId)) next.delete(categoryId);
      else next.add(categoryId);

      writeStoredValue("noted.collapsed", JSON.stringify([...next]));
      return next;
    });
  }

  return { collapsed, toggleCategory };
}
