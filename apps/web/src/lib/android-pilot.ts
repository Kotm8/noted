import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { createContext, useSyncExternalStore } from "react";

export const isAndroidPilot = import.meta.env.MODE === "android";
export const PilotOriginContext = createContext<string | null>(null);
export const PilotOwnerContext = createContext<string | null>(null);
const offlineListeners = new Set<() => void>();
let pilotOffline = false;

export const getPilotOffline = () => pilotOffline;

export function subscribePilotOffline(listener: () => void) {
  offlineListeners.add(listener);
  return () => {
    offlineListeners.delete(listener);
  };
}

export function usePilotOffline() {
  return useSyncExternalStore(
    subscribePilotOffline,
    getPilotOffline,
    () => false,
  );
}

interface PilotProfile {
  server: string | null;
  packageName: string;
}

export interface SharedMealPhoto {
  id: string;
  name: string;
}

interface PilotRequest {
  id: string;
  path: string;
  method: string;
  body?: string;
  multipart?: boolean;
}

type PilotLiveEvent =
  | { id: string; data: string }
  | { id: string; code: number };

type PilotTransfer = { id: string; direction: "upload" | "download" } & (
  | { bytes: number; total: number; done?: false }
  | { done: true }
);

export const androidPilot = registerPlugin<{
  profile(): Promise<PilotProfile>;
  connect(value: { server: string }): Promise<Pick<PilotProfile, "server">>;
  request(value: PilotRequest): Promise<{
    status: number;
    body?: string;
    streaming?: boolean;
    offline?: boolean;
    cachedAt?: number;
  }>;
  read(value: { id: string }): Promise<{ chunk: string; done: boolean }>;
  beginUpload(value: { id: string; path: string; type: string }): Promise<void>;
  appendUpload(value: {
    id: string;
    offset: number;
    chunk: string;
  }): Promise<void>;
  cancelRequest(value: { id: string }): Promise<void>;
  shareText(value: { text: string }): Promise<void>;
  openAiSignIn(value: { url: string }): Promise<void>;
  hideKeyboard(): Promise<void>;
  listWatches(): Promise<{ devices: { id: string; name: string }[] }>;
  pairWatch(value: { id: string }): Promise<void>;
  sharedPhotos(): Promise<{ photos: SharedMealPhoto[] }>;
  discardSharedPhotos(value: { ids: string[] }): Promise<void>;
  legacyWorkAvailable(): Promise<{ available: boolean }>;
  exportLegacyWork(): Promise<{ saved: boolean }>;
  downloadAttachment(value: { asset: string; name: string }): Promise<void>;
  notificationState(): Promise<{
    deviceId: string;
    paired: boolean;
    permission: "default" | "granted" | "denied";
  }>;
  enableNotifications(): Promise<void>;
  disableNotifications(): Promise<void>;
  reconcileNotifications(): Promise<void>;
  openLive(value: { id: string }): Promise<void>;
  closeLive(value: { id: string }): Promise<void>;
  addListener(
    event: "captureProblem",
    callback: (value: { message: string }) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    event: "notificationOpen",
    callback: (value: { path: string }) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    event: "liveEvent",
    callback: (value: PilotLiveEvent) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    event: "transferProgress",
    callback: (value: PilotTransfer) => void,
  ): Promise<PluginListenerHandle>;
}>("NotedPilot");

async function stageMultipart(
  id: string,
  path: string,
  body: FormData,
  signal?: AbortSignal,
) {
  const encoded = new Request(window.location.origin, { method: "POST", body });
  const type = encoded.headers.get("Content-Type");
  if (!type || !encoded.body) throw new Error("Couldn't prepare these files.");
  await androidPilot.beginUpload({ id, path, type });
  const reader = encoded.body.getReader();
  let offset = 0;
  try {
    while (true) {
      signal?.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) return;
      for (let i = 0; i < value.length; i += 65536) {
        signal?.throwIfAborted();
        const part = value.subarray(i, i + 65536);
        const chunk = btoa(String.fromCharCode(...part));
        await androidPilot.appendUpload({ id, offset, chunk });
        offset += part.length;
      }
    }
  } finally {
    await reader.cancel();
  }
}

export function connectPilotLive(
  message: (data: unknown) => void,
  closed: (code: number) => void,
) {
  const id = crypto.randomUUID();
  let active = true;
  const handle = androidPilot.addListener("liveEvent", (event) => {
    if (!active || event.id !== id) return;
    if ("data" in event) message(event.data);
    else finish(event.code);
  });

  function finish(code: number) {
    if (!active) return;
    active = false;
    void handle.then((listener) => listener.remove()).catch(() => {});
    queueMicrotask(() => closed(code));
  }

  void handle
    .then(async () => {
      if (active) await androidPilot.openLive({ id });
    })
    .catch(() => finish(1006));
  return {
    close() {
      if (!active) return;
      finish(1006);
      void androidPilot.closeLive({ id }).catch(() => {});
    },
  };
}

export async function pilotRequest(
  path: string,
  method: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<Response> {
  signal?.throwIfAborted();
  if (body instanceof Blob)
    throw new Error("This file operation is unavailable on Android.");
  const id = crypto.randomUUID();
  const abort = () => void androidPilot.cancelRequest({ id }).catch(() => {});
  const detach = () => signal?.removeEventListener("abort", abort);
  let streaming = false;
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const multipart = body instanceof FormData;
    if (multipart) await stageMultipart(id, path, body, signal);
    signal?.throwIfAborted();
    const result = await androidPilot.request({
      id,
      path,
      method,
      body: body === undefined || multipart ? undefined : JSON.stringify(body),
      multipart,
    });
    signal?.throwIfAborted();
    if (result.offline !== undefined && result.offline !== pilotOffline) {
      pilotOffline = result.offline;
      offlineListeners.forEach((listener) => listener());
    }
    if (result.streaming) {
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            signal?.throwIfAborted();
            const { chunk, done } = await androidPilot.read({ id });
            signal?.throwIfAborted();
            if (chunk)
              controller.enqueue(
                Uint8Array.from(atob(chunk), (byte) => byte.charCodeAt(0)),
              );
            if (done) {
              detach();
              controller.close();
            }
          } catch (error) {
            detach();
            abort();
            controller.error(error);
          }
        },
        cancel() {
          detach();
          abort();
        },
      });
      streaming = true;
      return new Response(stream, {
        status: result.status,
        headers: { "Content-Type": "application/x-ndjson" },
      });
    }
    return new Response(result.status === 204 ? null : result.body, {
      status: result.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    await androidPilot.cancelRequest({ id }).catch(() => {});
    throw error;
  } finally {
    if (!streaming) detach();
  }
}
