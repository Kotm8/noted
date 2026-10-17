import { afterEach, expect, it, vi } from "vitest";
import { ApiError, request } from "../../lib/http";
import { disconnectAndroid, initializeAndroidClient, isAndroidApp } from "./android";

vi.mock("../../lib/http", async (original) => ({
  ...await original<typeof import("../../lib/http")>(),
  request: vi.fn(),
}));

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, "", "/");
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

it("remembers the Android shell without losing notification action parameters", () => {
  window.history.replaceState(null, "", "/?client=android&note=123&reminderAction=snooze");
  initializeAndroidClient();
  expect(isAndroidApp()).toBe(true);
  expect(new URL(window.location.href).searchParams.has("client")).toBe(false);
  expect(new URL(window.location.href).searchParams.get("reminderAction")).toBe("snooze");
  expect(new URL(window.location.href).searchParams.get("note")).toBe("123");
});

it("unregisters the old server's push subscription before signing out", async () => {
  const unsubscribe = vi.fn().mockResolvedValue(true);
  vi.stubGlobal("navigator", { serviceWorker: { getRegistration: vi.fn().mockResolvedValue({
    pushManager: { getSubscription: vi.fn().mockResolvedValue({ unsubscribe }) },
  }) } });
  localStorage.setItem("noted.notification-device", "device-id");
  sessionStorage.setItem("noted.android-client", "browser");
  await disconnectAndroid();
  expect(request).toHaveBeenNthCalledWith(1, "/notifications/subscriptions/device-id", "DELETE");
  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(request).toHaveBeenNthCalledWith(2, "/auth/logout", "POST");
  expect(isAndroidApp()).toBe(false);
  expect(localStorage.getItem("noted.push-disabled")).toBe("yes");
});

it("allows returning to server selection after the session expired", async () => {
  localStorage.setItem("noted.notification-device", "device-id");
  vi.mocked(request).mockRejectedValue(new ApiError(401, "Sign in again"));
  await expect(disconnectAndroid()).resolves.toBeUndefined();
});

it("keeps the connection when server sign-out fails", async () => {
  sessionStorage.setItem("noted.android-client", "browser");
  vi.mocked(request).mockRejectedValue(new ApiError(503, "Unavailable"));
  await expect(disconnectAndroid()).rejects.toThrow("Unavailable");
  expect(isAndroidApp()).toBe(true);
});
