import type { QueryClient, QueryKey } from "@tanstack/react-query";

export interface LiveEvent {
  topic: string;
  channel?: string;
  thread?: string;
  entry?: string;
  workspace?: string;
  settings?: string;
}

const listeners = new Set<() => void>();
let connected = false;

export function liveConnected() {
  return connected;
}

export function subscribeLive(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function setConnected(value: boolean) {
  if (connected === value) return;
  connected = value;
  listeners.forEach((listener) => listener());
}

export function liveInterval(fallback: number, online = connected): number {
  return online ? 300000 : fallback;
}

function scoped(key: string, id?: string): QueryKey {
  return id ? [key, id] : [key];
}

export function liveQueryKeys(event: LiveEvent): QueryKey[] {
  switch (event.topic) {
    case "notes":
      return [
        scoped("notes", event.channel),
        scoped("thread", event.thread),
        ["home-activity"],
        ["search"],
      ];
    case "journals":
      return [
        scoped("journals", event.channel),
        scoped("journal-entry", event.entry),
        ["search"],
      ];
    case "document":
      return [scoped("channel-document", event.channel), ["search"]];
    case "structure":
      return [
        ["workspaces"],
        ["channels"],
        ["categories"],
        ["home-activity"],
        ["schedule"],
        ["publishing"],
        ["notes"],
        ["thread"],
        ["journals"],
        ["journal-entry"],
        ["channel-document"],
        ["search"],
      ];
    case "reminders":
      return [
        scoped("notes", event.channel),
        ["home-activity"],
        ["schedule"],
        ["thread"],
      ];
    case "schedule":
      return [["schedule"], ["schedule-plan"], ["home-activity"]];
    case "tracker":
      return [
        ["time-tracker"],
        ["activities"],
        ["watch-activities"],
        ["schedule"],
        ["home-activity"],
      ];
    case "prompts":
      return [["plan-prompts"], ["plan-prompt-history"], ["home-activity"]];
    case "publishing":
      return [["publishing"], ["home-activity"]];
    case "settings": {
      const keys: Record<string, string[]> = {
        appearance: ["appearance"],
        notifications: [
          "notification-settings",
          "android-server-configuration",
          "device-push-state",
        ],
        watch: ["watch-settings", "watch-activities"],
        tracking: ["time-tracker", "schedule"],
        server: [
          "server-settings",
          "android-server-configuration",
          "device-push-state",
        ],
      };
      return (
        event.settings
          ? (keys[event.settings] ?? [])
          : Object.values(keys).flat()
      ).map((key) => [key]);
    }
    case "sessions":
      return [["login-sessions"]];
    default:
      return [];
  }
}

export function invalidateLiveEvent(client: QueryClient, event: LiveEvent) {
  for (const queryKey of liveQueryKeys(event)) {
    void client.invalidateQueries({
      queryKey,
      refetchType: queryKey[0] === "search" ? "none" : "active",
    });
  }
}

export class LiveConnection {
  private socket: WebSocket | null = null;
  private reconnect: ReturnType<typeof setTimeout> | undefined;
  private watchdog: ReturnType<typeof setInterval> | undefined;
  private stopped = true;
  private attempts = 0;
  private opened = 0;
  private lastMessage = 0;

  constructor(private client: QueryClient) {}

  start() {
    this.stopped = false;
    window.addEventListener("online", this.resume);
    document.addEventListener("visibilitychange", this.visible);
    this.open();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.reconnect);
    clearInterval(this.watchdog);
    window.removeEventListener("online", this.resume);
    document.removeEventListener("visibilitychange", this.visible);
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    setConnected(false);
  }

  private visible = () => {
    if (document.visibilityState === "visible") this.resume();
  };

  private resume = () => {
    if (this.stopped) return;
    if (this.socket && Date.now() - this.lastMessage > 70000)
      this.socket.close();
    if (!this.socket || this.socket.readyState === WebSocket.CLOSED) {
      clearTimeout(this.reconnect);
      this.open();
    }
  };

  private open() {
    if (this.stopped) return;
    const url = new URL("/api/v1/live", window.location.origin);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(url);
    this.socket = socket;
    this.opened = this.lastMessage = Date.now();
    clearInterval(this.watchdog);
    this.watchdog = setInterval(() => {
      if (Date.now() - this.lastMessage > 70000) socket.close();
    }, 10000);
    socket.onmessage = ({ data }) => {
      if (
        this.socket !== socket ||
        typeof data !== "string" ||
        data.length > 8000
      )
        return;
      this.lastMessage = Date.now();
      try {
        const event = JSON.parse(data);
        if (event.type === "hello") {
          this.opened = Date.now();
          setConnected(true);
          void this.client.invalidateQueries({
            refetchType: "active",
            predicate: (query) => query.queryKey[0] !== "startup-data",
          });
        } else if (event && typeof event.topic === "string") {
          invalidateLiveEvent(this.client, event);
        }
      } catch {
        return;
      }
    };
    socket.onerror = () => socket.close();
    socket.onclose = ({ code }) => {
      if (this.socket !== socket || this.stopped) return;
      this.socket = null;
      clearInterval(this.watchdog);
      const wasConnected = liveConnected();
      setConnected(false);
      if (wasConnected)
        void this.client.invalidateQueries({
          refetchType: "active",
          predicate: (query) => query.queryKey[0] !== "startup-data",
        });
      if (code === 1000 || code === 1008)
        void this.client.invalidateQueries({ queryKey: ["session"] });
      if (wasConnected && Date.now() - this.opened > 60000) this.attempts = 0;
      const delay = Math.min(30000, 1000 * 2 ** Math.min(this.attempts++, 5));
      this.reconnect = setTimeout(
        () => this.open(),
        delay * (0.75 + Math.random() * 0.25),
      );
    };
  }
}
