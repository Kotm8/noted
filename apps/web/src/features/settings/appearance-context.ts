import { createContext, useContext } from "react";
import type { AppearancePreferences } from "./appearance";

interface AppearanceContextValue {
  preferences: AppearancePreferences;
  update: (changes: Partial<AppearancePreferences>) => void;
  reset: () => void;
  isSaving: boolean;
  saveError: string | null;
}

export const AppearanceContext = createContext<AppearanceContextValue | null>(null);

export function useAppearance() {
  const context = useContext(AppearanceContext);
  if (!context) throw new Error("Appearance settings require AppearanceProvider.");
  return context;
}
