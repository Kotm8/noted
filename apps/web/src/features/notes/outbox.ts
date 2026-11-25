import {
  useContext,
  useEffect,
  useLayoutEffect,
  useSyncExternalStore,
} from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError } from "../../lib/http";
import {
  getPilotOffline,
  PilotOriginContext,
  subscribePilotOffline,
} from "../../lib/android-pilot";
import { readStoredValue } from "../../lib/storage";
import type { ReminderSchedule } from "../reminders/types";
import { threadsApi } from "../threads/api";
import { notesApi } from "./api";
import {
  forgetFiles,
  keepFiles,
  keepQueuedNotes,
  readFiles,
  readQueuedNotes,
} from "./outbox-files";
import { cacheDelivered } from "./outbox-cache";

export interface Outgoing {
  clientId: string;
  channelId: string;
  content: string;
  reminder?: ReminderSchedule;
  /** A thread reply; otherwise a message in the channel. */
  threadRootId?: string;
  /** Names of the files kept in IndexedDB for it, to show while it waits. */
  files?: { name: string; size: number }[];
  writtenAt: string;
  /** Set when the server refused it, so it stops retrying until you choose Retry. */
  error?: string;
  retryOnReconnect?: boolean;
  sending?: boolean;
}

const KEY = "noted.outbox";
const RETRY_MS = 15000;
const listeners = new Set<() => void>();
let key: string | null = null;
let durable = false;
let generation = 0;
let items: Outgoing[] = [];
let sending = false;
let recovering: Promise<void> = Promise.resolve();
let writes: Promise<void> = Promise.resolve();

function load(source = key): Outgoing[] {
  try {
    const parsed: unknown = JSON.parse(
      source ? (readStoredValue(source) ?? "[]") : "[]",
    );
    return Array.isArray(parsed)
      ? (parsed as Outgoing[]).map((item) => ({ ...item, sending: false }))
      : [];
  } catch {
    return [];
  }
}
function publish(next: Outgoing[]) {
  items = next;
  listeners.forEach((listener) => listener());
}

function save(change: (current: Outgoing[]) => Outgoing[]) {
  const scope = key;
  const epoch = generation;
  const persistInDatabase = durable;
  const update = writes.then(async () => {
    if (!scope || scope !== key || epoch !== generation)
      throw new Error("The active account changed. Your draft has been kept.");
    const next = change(items);
    if (next === items) return;
    try {
      if (persistInDatabase) await keepQueuedNotes(scope, next);
      else localStorage.setItem(scope, JSON.stringify(next));
    } catch {
      throw new Error(
        "This device could not keep the message. Free some browser storage and retry.",
      );
    }
    if (scope === key && epoch === generation) publish(next);
  });
  writes = update.catch(() => {});
  return update;
}

/**
 * The request never reached the server: no connection, or the desktop app couldn't reach
 * it. Anything the server itself answered is a real refusal and isn't retried.
 */
export function unreachable(error: unknown) {
  return !(error instanceof ApiError) || [502, 503, 504].includes(error.status);
}

/** Messages already waiting go first, so a new one waits behind them to keep the order. */
export function hasWaiting() {
  return items.some((item) => !item.error || item.retryOnReconnect);
}

/** Files are stored first, so a message never waits without them. */
export async function enqueue(
  item: Omit<Outgoing, "writtenAt" | "files">,
  files: File[] = [],
) {
  const scope = key;
  const epoch = generation;
  if (!scope) throw new Error("Sign in before sending a message.");
  await recovering;
  if (files.length) await keepFiles(item.clientId, files);
  try {
    if (scope !== key || epoch !== generation)
      throw new Error("The active account changed. Your draft has been kept.");
    await save((current) => [
      ...current,
      {
        ...item,
        ...(files.length
          ? { files: files.map(({ name, size }) => ({ name, size })) }
          : {}),
        writtenAt: new Date().toISOString(),
      },
    ]);
  } catch (error) {
    if (files.length) await forgetFiles(item.clientId).catch(() => {});
    throw error;
  }
}

export async function discard(clientId: string) {
  let hadFiles = false;
  try {
    await save((current) => {
      const item = current.find((entry) => entry.clientId === clientId);
      if (!item || item.sending) return current;
      hadFiles = Boolean(item.files);
      return current.filter((entry) => entry.clientId !== clientId);
    });
    if (hadFiles) await forgetFiles(clientId).catch(() => {});
  } catch (error) {
    toast.error((error as Error).message);
  }
}

async function deliver(item: Outgoing, stillActive: () => boolean) {
  if (item.threadRootId && !item.files)
    return threadsApi.reply(item.threadRootId, item.content, item.clientId);
  if (!item.files)
    return notesApi.create(
      item.channelId,
      item.content,
      item.reminder,
      item.clientId,
    );
  const files = await readFiles(item.clientId).catch(() => undefined);
  if (!stillActive()) throw new Error("The active account changed.");
  if (!files?.length)
    throw new ApiError(410, "Its files are no longer on this device.");
  if (item.threadRootId)
    return threadsApi.replyWithFiles(
      item.threadRootId,
      item.content,
      files,
      item.clientId,
    );
  return notesApi.createWithFiles(
    item.channelId,
    item.content,
    files,
    item.reminder,
    item.clientId,
  );
}

/**
 * Sends waiting messages oldest first, one at a time, each under its own client id so a
 * retry after a dropped response can't post twice. Stops at the first unreachable send.
 */
export async function flushOutbox(client: QueryClient) {
  try {
    await recovering;
  } catch {
    return;
  }
  if (sending || !key || !navigator.onLine || getPilotOffline()) return;
  const scope = key;
  const epoch = generation;
  const stillActive = () => key === scope && epoch === generation;
  sending = true;
  try {
    for (const queued of [...items]) {
      if (key !== scope || epoch !== generation || getPilotOffline()) break;
      const item = items.find((entry) => entry.clientId === queued.clientId);
      if (!item) continue;
      if (item.error && !item.retryOnReconnect) continue;
      await save((current) =>
        current.map((entry) =>
          entry.clientId === item.clientId
            ? { ...entry, sending: true, error: undefined }
            : entry,
        ),
      );
      if (
        !stillActive() ||
        !items.some((entry) => entry.clientId === item.clientId)
      )
        break;
      try {
        const note = await deliver(item, stillActive);
        if (key !== scope || epoch !== generation) break;
        cacheDelivered(client, note);
        await save((current) =>
          current.filter((entry) => entry.clientId !== item.clientId),
        );
        if (item.files) await forgetFiles(item.clientId).catch(() => {});
        void client.invalidateQueries({ queryKey: ["notes", item.channelId] });
        if (item.threadRootId)
          void client.invalidateQueries({
            queryKey: ["thread", item.threadRootId],
          });
        void client.invalidateQueries({ queryKey: ["home-activity"] });
        void client.invalidateQueries({ queryKey: ["search"] });
        void client.invalidateQueries({ queryKey: ["publishing"] });
      } catch (error) {
        if (key !== scope || epoch !== generation) break;
        const unauthorized = error instanceof ApiError && error.status === 401;
        const reconnect = unauthorized || unreachable(error);
        await save((current) =>
          current.map((entry) =>
            entry.clientId === item.clientId
              ? {
                  ...entry,
                  error: (error as Error).message,
                  sending: false,
                  retryOnReconnect: reconnect,
                }
              : entry,
          ),
        );
        if (unauthorized)
          void client.invalidateQueries(
            { queryKey: ["session"], exact: true },
            { cancelRefetch: false },
          );
        if (reconnect) break;
      }
    }
  } catch (error) {
    if (stillActive()) toast.error((error as Error).message);
  } finally {
    sending = false;
    if (key !== scope || epoch !== generation) void flushOutbox(client);
  }
}

export async function retry(client: QueryClient, clientId: string) {
  try {
    await save((current) =>
      current.map((item) =>
        item.clientId === clientId ? { ...item, error: undefined } : item,
      ),
    );
    void flushOutbox(client);
  } catch (error) {
    toast.error((error as Error).message);
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Waiting messages of a channel, or of one thread when `threadRootId` is given. */
export function useOutbox(channelId: string, threadRootId?: string) {
  const all = useSyncExternalStore(subscribe, () => items);
  return all.filter(
    (item) =>
      item.channelId === channelId && item.threadRootId === threadRootId,
  );
}

/** Mounted once: sends when the connection returns, on a timer, and at startup. */
export function useOutboxSender() {
  const client = useQueryClient();
  const origin = useContext(PilotOriginContext);
  const ownerId = client.getQueryData<{ id: string }>(["session"])?.id;
  useLayoutEffect(() => {
    generation++;
    const ownerKey = ownerId ? `${KEY}:${ownerId}` : null;
    durable = Boolean(origin);
    if (ownerKey && origin) {
      key = `${ownerKey}:${origin}`;
      publish([]);
      recovering = hydratePilotQueue(key, ownerKey, origin, generation);
      void recovering.catch(() =>
        toast.error("Couldn't read the messages saved on this phone."),
      );
    } else {
      key = ownerKey;
      publish(load());
      recovering = recoverLegacy();
    }
    return () => {
      generation++;
      key = null;
    };
  }, [ownerId, origin]);
  useEffect(() => {
    const send = () => void flushOutbox(client);
    send();
    const timer = window.setInterval(() => {
      if (hasWaiting()) send();
    }, RETRY_MS);
    window.addEventListener("online", send);
    const unsubscribe = subscribePilotOffline(() => {
      if (!getPilotOffline()) send();
    });
    const storage = (event: StorageEvent) => {
      if (durable || event.key !== key) return;
      publish(load());
    };
    window.addEventListener("storage", storage);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", send);
      unsubscribe();
      window.removeEventListener("storage", storage);
    };
  }, [client, ownerId, origin]);
}

async function hydratePilotQueue(
  scopedKey: string,
  ownerKey: string,
  origin: string,
  epoch: number,
) {
  await writes;
  let saved = await readQueuedNotes<Outgoing>(scopedKey);
  if (scopedKey !== key || epoch !== generation) return;
  const pin = `${ownerKey}:origin`;
  const pinnedOrigin = readStoredValue(pin);
  if (saved === undefined) {
    const legacy =
      !pinnedOrigin || pinnedOrigin === origin ? load(ownerKey) : [];
    const byId = new Map(legacy.map((item) => [item.clientId, item]));
    for (const item of load(scopedKey)) byId.set(item.clientId, item);
    saved = [...byId.values()].sort((left, right) =>
      left.writtenAt.localeCompare(right.writtenAt),
    );
    await keepQueuedNotes(scopedKey, saved);
    if (scopedKey !== key || epoch !== generation) return;
    if (legacy.length && (!pinnedOrigin || pinnedOrigin === origin)) {
      localStorage.setItem(pin, origin);
      localStorage.removeItem(ownerKey);
    }
    localStorage.removeItem(scopedKey);
  }
  publish(saved.map((entry) => ({ ...entry, sending: false })));
}

async function recoverLegacy() {
  const scope = key;
  const epoch = generation;
  if (!scope || !navigator.onLine || getPilotOffline()) return;
  let legacy: Outgoing[];
  try {
    const saved: unknown = JSON.parse(readStoredValue(KEY) ?? "[]");
    if (!Array.isArray(saved)) return;
    legacy = saved as Outgoing[];
  } catch {
    return;
  }
  const channels = new Map<string, boolean>();
  for (const item of legacy) {
    if (key !== scope || generation !== epoch) return;
    let owned = channels.get(item.channelId);
    if (owned === undefined) {
      try {
        await notesApi.list(item.channelId, {});
        owned = true;
      } catch {
        owned = false;
      }
      channels.set(item.channelId, owned);
    }
    if (!owned || key !== scope || generation !== epoch) continue;
    try {
      if (!items.some((current) => current.clientId === item.clientId)) {
        await save((current) =>
          [...current, { ...item, sending: false }].sort((left, right) =>
            left.writtenAt.localeCompare(right.writtenAt),
          ),
        );
      }
      const remaining = JSON.parse(readStoredValue(KEY) ?? "[]") as Outgoing[];
      localStorage.setItem(
        KEY,
        JSON.stringify(
          remaining.filter((old) => old.clientId !== item.clientId),
        ),
      );
    } catch {
      return;
    }
  }
}
