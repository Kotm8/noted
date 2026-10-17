import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

function worker() {
  const handlers: Record<string, (event: unknown) => void> = {};
  const showNotification = vi.fn().mockResolvedValue(undefined);
  const openWindow = vi.fn().mockResolvedValue(undefined);
  const navigate = vi.fn().mockResolvedValue(undefined);
  const focus = vi.fn().mockResolvedValue(undefined);
  const skipWaiting = vi.fn().mockResolvedValue(undefined);
  const claim = vi.fn().mockResolvedValue(undefined);
  const self = {
    skipWaiting,
    addEventListener: (name: string, handler: (event: unknown) => void) => {
      handlers[name] = handler;
    },
    registration: { showNotification },
    location: { origin: "https://notes.example.com" },
    clients: {
      claim,
      matchAll: vi
        .fn()
        .mockResolvedValue([
          { url: "https://notes.example.com/", navigate, focus },
        ]),
      openWindow,
    },
  };
  runInNewContext(readFileSync(resolve("public/notifications-sw.js"), "utf8"), {
    self,
    URL,
  });
  return { handlers, showNotification, openWindow, navigate, focus, skipWaiting, claim };
}

describe("notification service worker", () => {
  it("activates notification fixes for already open clients", async () => {
    const test = worker();
    const waitUntil = vi.fn();
    test.handlers.install({ waitUntil });
    test.handlers.activate({ waitUntil });
    await Promise.all(waitUntil.mock.calls.map(([pending]) => pending));
    expect(test.skipWaiting).toHaveBeenCalled();
    expect(test.claim).toHaveBeenCalled();
  });

  it("displays server diagnostic pushes without reminder actions", async () => {
    const test = worker();
    const data = { kind: "diagnostic", testId: "test-1", title: "Noted / Push test", body: "Server test", url: "/" };
    const waitUntil = vi.fn();
    test.handlers.push({ data: { json: () => data }, waitUntil });
    await waitUntil.mock.calls[0][0];
    expect(test.showNotification).toHaveBeenCalledWith(data.title, expect.objectContaining({ tag: "noted-test-test-1", actions: [] }));
  });

  it("opens the home page when a local diagnostic notification has no data", async () => {
    const test = worker();
    const waitUntil = vi.fn();
    test.handlers.notificationclick({ notification: { close: vi.fn() }, action: "", waitUntil });
    await waitUntil.mock.calls[0][0];
    expect(test.navigate).toHaveBeenCalledWith("https://notes.example.com/");
  });

  it("shows project, channel and content with Done and configured Snooze", async () => {
    const test = worker();
    const data = {
      title: "Work / #reminders",
      body: "Take a break",
      messageId: "message",
      revision: 2,
      snoozeMinutes: 25,
    };
    const waitUntil = vi.fn();
    test.handlers.push({ data: { json: () => data }, waitUntil });
    await waitUntil.mock.calls[0][0];
    expect(test.showNotification).toHaveBeenCalledWith(
      data.title,
      expect.objectContaining({
        body: data.body,
        tag: "reminder-message",
        actions: [
          { action: "done", title: "Done" },
          { action: "snooze", title: "Snooze 25m" },
        ],
      }),
    );
  });

  it("opens the authenticated app to apply an action to the correct revision", async () => {
    const test = worker();
    const waitUntil = vi.fn();
    test.handlers.notificationclick({
      notification: {
        close: vi.fn(),
        data: {
          url: "/w/project/c/channel?note=message",
          revision: 3,
          snoozeMinutes: 25,
        },
      },
      action: "snooze",
      waitUntil,
    });
    await waitUntil.mock.calls[0][0];
    expect(test.navigate).toHaveBeenCalledWith(
      "https://notes.example.com/w/project/c/channel?note=message&reminderAction=snooze&revision=3&snoozeMinutes=25",
    );
    expect(test.focus).toHaveBeenCalled();
    expect(test.openWindow).not.toHaveBeenCalled();
  });

  it("rejects notification links to another origin", () => {
    const test = worker();
    const waitUntil = vi.fn();
    test.handlers.notificationclick({
      notification: {
        close: vi.fn(),
        data: { url: "https://other.example.com/" },
      },
      action: "",
      waitUntil,
    });
    expect(waitUntil).not.toHaveBeenCalled();
  });
});
