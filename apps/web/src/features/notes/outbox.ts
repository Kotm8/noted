import { useEffect, useLayoutEffect, useSyncExternalStore } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { ApiError } from "../../lib/http";
import { readStoredValue } from "../../lib/storage";
import type { ReminderSchedule } from "../reminders/types";
import { threadsApi } from "../threads/api";
import { notesApi } from "./api";
import { forgetFiles, keepFiles, readFiles } from "./outbox-files";
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
let items: Outgoing[] = [];
let sending = false;
let recovering: Promise<void> = Promise.resolve();

function load(): Outgoing[] {
  try {
    const parsed: unknown = JSON.parse(
      key ? (readStoredValue(key) ?? "[]") : "[]",
    );
    return Array.isArray(parsed)
      ? (parsed as Outgoing[]).map((item) => ({ ...item, sending: false }))
      : [];
  } catch {
    return [];
  }
}
function save(next: Outgoing[]) {
  if (key) {
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      throw new Error(
        "This device could not keep the message. Free some browser storage and retry.",
      );
    }
  }
  items = next;
  listeners.forEach((listener) => listener());
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
  if (!scope) throw new Error("Sign in before sending a message.");
  await recovering;
  if (files.length) await keepFiles(item.clientId, files);
  if (scope !== key)
    throw new Error("The active account changed. Your draft has been kept.");
  try {
    save([
      ...items,
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

export function discard(clientId: string) {
  const item = items.find((entry) => entry.clientId === clientId);
  if (item?.sending) return;
  save(items.filter((entry) => entry.clientId !== clientId));
  if (item?.files) void forgetFiles(clientId).catch(() => {});
}

async function deliver(item: Outgoing) {
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
  await recovering;
  if (sending || !key || !navigator.onLine) return;
  const scope = key;
  sending = true;
  try {
    for (const item of [...items]) {
      if (key !== scope) break;
      if (item.error && !item.retryOnReconnect) continue;
      save(
        items.map((entry) =>
          entry.clientId === item.clientId
            ? { ...entry, sending: true, error: undefined }
            : entry,
        ),
      );
      try {
        const note = await deliver(item);
        if (key !== scope) break;
        cacheDelivered(client, note);
        save(
          items.map((entry) =>
            entry.clientId === item.clientId
              ? { ...entry, sending: false }
              : entry,
          ),
        );
        discard(item.clientId);
        void client.invalidateQueries({ queryKey: ["notes", item.channelId] });
        if (item.threadRootId)
          void client.invalidateQueries({
            queryKey: ["thread", item.threadRootId],
          });
        void client.invalidateQueries({ queryKey: ["home-activity"] });
        void client.invalidateQueries({ queryKey: ["search"] });
        void client.invalidateQueries({ queryKey: ["publishing"] });
      } catch (error) {
        if (key !== scope) break;
        const reconnect = unreachable(error);
        save(
          items.map((entry) =>
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
        if (reconnect) break;
      }
    }
  } finally {
    sending = false;
    if (key !== scope) void flushOutbox(client);
  }
}

export function retry(client: QueryClient, clientId: string) {
  save(
    items.map((item) =>
      item.clientId === clientId ? { ...item, error: undefined } : item,
    ),
  );
  void flushOutbox(client);
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
  const ownerId = client.getQueryData<{ id: string }>(["session"])?.id;
  useLayoutEffect(() => {
    key = ownerId ? `${KEY}:${ownerId}` : null;
    items = load();
    listeners.forEach((listener) => listener());
    recovering = recoverLegacy();
    return () => {
      key = null;
    };
  }, [ownerId]);
  useEffect(() => {
    const send = () => void flushOutbox(client);
    send();
    const timer = window.setInterval(() => {
      if (hasWaiting()) send();
    }, RETRY_MS);
    window.addEventListener("online", send);
    const storage = (event: StorageEvent) => {
      if (event.key !== key) return;
      items = load();
      listeners.forEach((listener) => listener());
    };
    window.addEventListener("storage", storage);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", send);
      window.removeEventListener("storage", storage);
    };
  }, [client, ownerId]);
}

async function recoverLegacy() {
  const scope = key;
  if (!scope || !navigator.onLine) return;
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
    if (key !== scope) return;
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
    if (!owned || key !== scope) continue;
    try {
      if (!items.some((current) => current.clientId === item.clientId)) {
        save(
          [...items, { ...item, sending: false }].sort((left, right) =>
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
