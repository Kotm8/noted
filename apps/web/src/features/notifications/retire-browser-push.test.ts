import { afterEach, expect, it, vi } from "vitest";
import { retireBrowserPush } from "./retire-browser-push";

afterEach(() => vi.unstubAllGlobals());

it("removes old Noted subscriptions and notices while preserving unrelated workers", async () => {
  const unsubscribe = vi.fn().mockResolvedValue(true);
  const close = vi.fn();
  const unregister = vi.fn().mockResolvedValue(true);
  const otherUnregister = vi.fn();
  vi.stubGlobal("navigator", {
    serviceWorker: {
      getRegistrations: async () => [
        {
          active: {
            scriptURL: `${window.location.origin}/notifications-sw.js`,
          },
          pushManager: { getSubscription: async () => ({ unsubscribe }) },
          getNotifications: async () => [{ close }],
          unregister,
        },
        {
          active: { scriptURL: `${window.location.origin}/other-worker.js` },
          unregister: otherUnregister,
        },
      ],
    },
  });
  await retireBrowserPush();
  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledOnce();
  expect(unregister).toHaveBeenCalledOnce();
  expect(otherUnregister).not.toHaveBeenCalled();
});

it("still unregisters the old worker when its subscription cannot be inspected", async () => {
  const unregister = vi.fn().mockResolvedValue(true);
  vi.stubGlobal("navigator", {
    serviceWorker: {
      getRegistrations: async () => [
        {
          waiting: {
            scriptURL: `${window.location.origin}/notifications-sw.js`,
          },
          pushManager: {
            getSubscription: vi
              .fn()
              .mockRejectedValue(new Error("unavailable")),
          },
          getNotifications: async () => [],
          unregister,
        },
      ],
    },
  });
  await retireBrowserPush();
  expect(unregister).toHaveBeenCalledOnce();
});
