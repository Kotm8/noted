import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { writeStoredValue } from "../../lib/storage";
import { authApi } from "../auth/api";
import { settingsApi } from "./api";
import {
  APPEARANCE_KEY,
  applyAppearance,
  defaultAppearance,
  readAppearance,
  type AppearancePreferences,
} from "./appearance";
import { AppearanceContext } from "./appearance-context";

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [fallback, setFallback] = useState(readAppearance);
  const latestChange = useRef(0);
  const session = useQuery({ queryKey: ["session"], queryFn: authApi.getSession });
  const queryKey = ["appearance", session.data?.id];
  const appearance = useQuery({
    queryKey,
    enabled: Boolean(session.data),
    refetchInterval: 30000,
    queryFn: async () => {
      const saved = await settingsApi.getAppearance();
      if (saved) return saved;
      return settingsApi.saveAppearance(readAppearance(), true);
    },
  });
  const preferences = appearance.data ?? fallback;
  const save = useMutation({
    scope: { id: "appearance" },
    mutationFn: ({ changes }: { changes: Partial<AppearancePreferences>; sequence: number }) =>
      settingsApi.saveAppearance(changes),
    onMutate: () => client.cancelQueries({ queryKey }),
    onSuccess: (saved, { sequence }) => {
      if (sequence === latestChange.current) client.setQueryData(queryKey, saved);
    },
    onSettled: (_data, _error, { sequence }) => {
      if (sequence === latestChange.current) void client.invalidateQueries({ queryKey });
    },
  });

  useLayoutEffect(() => {
    applyAppearance(preferences);
    writeStoredValue(APPEARANCE_KEY, JSON.stringify({ ...preferences, version: 2 }));
  }, [preferences]);

  function update(changes: Partial<AppearancePreferences>) {
    const updated = { ...preferences, ...changes };
    if (!session.data) {
      setFallback(updated);
      return;
    }
    latestChange.current += 1;
    client.setQueryData(queryKey, updated);
    save.mutate({ changes, sequence: latestChange.current });
  }

  return (
    <AppearanceContext.Provider value={{
      preferences,
      update,
      reset: () => update(defaultAppearance),
      isSaving: save.isPending,
      saveError: save.error?.message ?? null,
    }}>
      {children}
    </AppearanceContext.Provider>
  );
}
