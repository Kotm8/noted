import { useEffect, useSyncExternalStore } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { ApiError } from "../../lib/http";
import { readStoredValue, writeStoredValue } from "../../lib/storage";
import type { ReminderSchedule } from "../reminders/types";
import { threadsApi } from "../threads/api";
import { notesApi } from "./api";
import { forgetFiles, keepFiles, readFiles } from "./outbox-files";

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
}

const KEY = "noted.outbox";
const RETRY_MS = 15000;
const listeners = new Set<() => void>();
let items: Outgoing[] = load();
let sending = false;

function load(): Outgoing[] {
  try {
    const parsed: unknown = JSON.parse(readStoredValue(KEY) ?? "[]");
    return Array.isArray(parsed) ? (parsed as Outgoing[]) : [];
  } catch {
    return [];
  }
}
function save(next: Outgoing[]) {
  items = next;
  writeStoredValue(KEY, JSON.stringify(next));
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
  return items.some((item) => !item.error);
}

/** Files are stored first, so a message never waits without them. */
export async function enqueue(
  item: Omit<Outgoing, "writtenAt" | "files">,
  files: File[] = [],
) {
  if (files.length) await keepFiles(item.clientId, files);
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
}

export function discard(clientId: string) {
  const item = items.find((entry) => entry.clientId === clientId);
  save(items.filter((entry) => entry.clientId !== clientId));
  if (item?.files) void forgetFiles(clientId).catch(() => {});
}

async function deliver(item: Outgoing) {
  if (item.threadRootId)
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
  if (sending) return;
  sending = true;
  try {
    for (const item of [...items]) {
      if (item.error) continue;
      try {
        await deliver(item);
        discard(item.clientId);
        void client.invalidateQueries({ queryKey: ["notes", item.channelId] });
        if (item.threadRootId)
          void client.invalidateQueries({
            queryKey: ["thread", item.threadRootId],
          });
        void client.invalidateQueries({ queryKey: ["home-activity"] });
      } catch (error) {
        if (unreachable(error)) break;
        save(
          items.map((entry) =>
            entry.clientId === item.clientId
              ? { ...entry, error: (error as Error).message }
              : entry,
          ),
        );
      }
    }
  } finally {
    sending = false;
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
  useEffect(() => {
    const send = () => void flushOutbox(client);
    send();
    const timer = window.setInterval(() => {
      if (hasWaiting()) send();
    }, RETRY_MS);
    window.addEventListener("online", send);
    const storage = (event: StorageEvent) => {
      if (event.key !== KEY) return;
      items = load();
      listeners.forEach((listener) => listener());
    };
    window.addEventListener("storage", storage);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", send);
      window.removeEventListener("storage", storage);
    };
  }, [client]);
}
