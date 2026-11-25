import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";

it("retires installed notification workers without handling or displaying pushes", async () => {
  const handlers: Record<string, (event: unknown) => void> = {};
  const unsubscribe = vi.fn().mockResolvedValue(true);
  const close = vi.fn();
  const unregister = vi.fn().mockResolvedValue(true);
  const skipWaiting = vi.fn().mockResolvedValue(undefined);
  const self = {
    skipWaiting,
    addEventListener: (name: string, handler: (event: unknown) => void) => {
      handlers[name] = handler;
    },
    registration: {
      pushManager: { getSubscription: async () => ({ unsubscribe }) },
      getNotifications: async () => [{ close }],
      unregister,
    },
  };
  runInNewContext(readFileSync(resolve("public/notifications-sw.js"), "utf8"), {
    self,
  });
  expect(handlers.push).toBeUndefined();
  expect(handlers.notificationclick).toBeUndefined();
  const waitUntil = vi.fn();
  handlers.install({ waitUntil });
  handlers.activate({ waitUntil });
  await Promise.all(waitUntil.mock.calls.map(([pending]) => pending));
  expect(skipWaiting).toHaveBeenCalledOnce();
  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledOnce();
  expect(unregister).toHaveBeenCalledOnce();
});
