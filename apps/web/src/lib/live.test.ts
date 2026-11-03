import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LiveConnection,
  invalidateLiveEvent,
  liveConnected,
  liveInterval,
  liveQueryKeys,
} from "./live";

class FakeSocket {
  static CLOSED = 3;
  static sockets: FakeSocket[] = [];
  readyState = 1;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: URL) {
    FakeSocket.sockets.push(this);
  }
  message(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
  close(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

describe("live updates", () => {
  let connection: LiveConnection;
  let client: QueryClient;
  beforeEach(() => {
    vi.useFakeTimers();
    FakeSocket.sockets = [];
    vi.stubGlobal("WebSocket", FakeSocket);
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    connection = new LiveConnection(client);
  });
  afterEach(() => {
    connection.stop();
    client.clear();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("targets the changed channel, reply root, and journal entry", () => {
    expect(
      liveQueryKeys({ topic: "notes", channel: "one", thread: "root" }),
    ).toEqual([
      ["notes", "one"],
      ["thread", "root"],
      ["home-activity"],
      ["search"],
    ]);
    expect(
      liveQueryKeys({ topic: "journals", channel: "two", entry: "entry" }),
    ).toEqual([["journals", "two"], ["journal-entry", "entry"], ["search"]]);
    expect(liveQueryKeys({ topic: "document", channel: "three" })[0]).toEqual([
      "channel-document",
      "three",
    ]);
    expect(
      liveQueryKeys({ topic: "structure", workspace: "project" }),
    ).toContainEqual(["channels"]);
    expect(liveQueryKeys({ topic: "unknown" })).toEqual([]);
  });

  it.each([
    ["reminders", "schedule"],
    ["schedule", "schedule-plan"],
    ["tracker", "time-tracker"],
    ["prompts", "plan-prompt-history"],
    ["publishing", "publishing"],
    ["sessions", "login-sessions"],
  ])("maps %s to %s", (topic, key) => {
    expect(liveQueryKeys({ topic })).toContainEqual([key]);
  });

  it("only refreshes the affected settings and marks search stale lazily", () => {
    expect(
      liveQueryKeys({ topic: "settings", settings: "appearance" }),
    ).toEqual([["appearance"]]);
    const invalidate = vi.spyOn(client, "invalidateQueries");
    invalidateLiveEvent(client, { topic: "notes", channel: "one" });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["search"],
      refetchType: "none",
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["notes", "one"],
      refetchType: "active",
    });
  });

  it("failed handshakes leave the existing polling schedule alone", async () => {
    const invalidate = vi.spyOn(client, "invalidateQueries");
    connection.start();
    FakeSocket.sockets[0].close();
    await vi.advanceTimersByTimeAsync(1000);
    FakeSocket.sockets[1].close();
    expect(invalidate).not.toHaveBeenCalled();
    expect(liveInterval(15000)).toBe(15000);
  });

  it("slows polling only after hello and restores it on disconnect", () => {
    expect(liveInterval(5000)).toBe(5000);
    connection.start();
    expect(liveConnected()).toBe(false);
    FakeSocket.sockets[0].message({ type: "hello" });
    expect(liveInterval(5000)).toBe(300000);
    FakeSocket.sockets[0].close();
    expect(liveInterval(15000)).toBe(15000);
  });

  it("reconnects, catches up active queries, and ignores an old connection", async () => {
    const invalidate = vi.spyOn(client, "invalidateQueries");
    connection.start();
    const first = FakeSocket.sockets[0];
    first.message({ type: "hello" });
    first.close();
    await vi.advanceTimersByTimeAsync(1000);
    expect(FakeSocket.sockets).toHaveLength(2);
    const second = FakeSocket.sockets[1];
    second.message({ type: "hello" });
    expect(liveConnected()).toBe(true);
    invalidate.mockClear();
    first.message({ topic: "tracker" });
    expect(invalidate).not.toHaveBeenCalled();
    second.message({ topic: "tracker" });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["time-tracker"],
      refetchType: "active",
    });
    connection.stop();
    await vi.advanceTimersByTimeAsync(90000);
    expect(FakeSocket.sockets).toHaveLength(2);
  });

  it("reconnects immediately when the network returns and closes half-dead sockets", async () => {
    connection.start();
    FakeSocket.sockets[0].close();
    window.dispatchEvent(new Event("online"));
    expect(FakeSocket.sockets).toHaveLength(2);
    FakeSocket.sockets[1].message({ type: "hello" });
    await vi.advanceTimersByTimeAsync(80000);
    expect(FakeSocket.sockets[1].readyState).toBe(FakeSocket.CLOSED);
    expect(liveConnected()).toBe(false);
  });
});
