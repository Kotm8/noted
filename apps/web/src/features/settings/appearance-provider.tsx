import { liveInterval } from "../../lib/live";
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

type PendingAppearance = {
  changes: Partial<AppearancePreferences>;
  sequence: number;
};

function mergePreferences(
  base: AppearancePreferences,
  changes: Partial<AppearancePreferences>,
) {
  return {
    ...base,
    ...changes,
    profiles:
      changes.profiles && Object.keys(changes.profiles).length
        ? { ...base.profiles, ...changes.profiles }
        : (changes.profiles ?? base.profiles),
  };
}

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [fallback, setFallback] = useState(readAppearance);
  const latestChange = useRef(0);
  const generation = useRef(0);
  const pending = useRef<PendingAppearance[]>([]);
  const project = (saved: AppearancePreferences) =>
    pending.current.reduce(
      (value, item) => mergePreferences(value, item.changes),
      saved,
    );
  const session = useQuery({
    queryKey: ["session"],
    queryFn: authApi.getSession,
  });
  const queryKey = ["appearance", session.data?.id];
  const appearance = useQuery({
    queryKey,
    enabled: Boolean(session.data),
    refetchInterval: () => liveInterval(30000),
    queryFn: async () => {
      const started = generation.current;
      const saved =
        (await settingsApi.getAppearance()) ??
        (await settingsApi.saveAppearance(readAppearance(), true));
      if (started !== generation.current)
        return (
          client.getQueryData<AppearancePreferences>(queryKey) ??
          project({ ...defaultAppearance, ...saved })
        );
      return project({ ...defaultAppearance, ...saved });
    },
  });
  const preferences = appearance.data ?? fallback;
  const save = useMutation({
    scope: { id: "appearance" },
    mutationFn: ({ changes }: PendingAppearance) =>
      settingsApi.saveAppearance(changes),
    onSuccess: (saved, { sequence }) => {
      generation.current += 1;
      pending.current = pending.current.filter(
        (item) => item.sequence !== sequence,
      );
      client.setQueryData(
        queryKey,
        project({ ...defaultAppearance, ...saved }),
      );
    },
    onError: (_error, { sequence }) => {
      generation.current += 1;
      pending.current = pending.current.filter(
        (item) => item.sequence !== sequence,
      );
    },
    onSettled: () => {
      if (!pending.current.length) void client.invalidateQueries({ queryKey });
    },
  });

  useLayoutEffect(() => {
    applyAppearance(preferences);
    writeStoredValue(
      APPEARANCE_KEY,
      JSON.stringify({ ...preferences, version: 2 }),
    );
  }, [preferences]);

  function update(changes: Partial<AppearancePreferences>) {
    const current =
      client.getQueryData<AppearancePreferences>(queryKey) ?? preferences;
    const updated = mergePreferences(current, changes);
    if (!session.data) {
      setFallback(updated);
      return;
    }
    latestChange.current += 1;
    generation.current += 1;
    const patch = { ...changes };
    if (changes.profiles && Object.keys(changes.profiles).length) {
      const changed = Object.fromEntries(
        Object.entries(changes.profiles).filter(
          ([key, value]) =>
            JSON.stringify(value) !==
            JSON.stringify(
              current.profiles[key as keyof typeof current.profiles],
            ),
        ),
      );
      if (Object.keys(changed).length) patch.profiles = changed;
      else delete patch.profiles;
    }
    const operation = { changes: patch, sequence: latestChange.current };
    pending.current.push(operation);
    client.setQueryData(queryKey, updated);
    save.mutate(operation);
  }

  return (
    <AppearanceContext.Provider
      value={{
        preferences,
        update,
        reset: () => update(defaultAppearance),
        isSaving: save.isPending,
        saveError: save.error?.message ?? null,
      }}
    >
      {children}
    </AppearanceContext.Provider>
  );
}
