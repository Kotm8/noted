import { afterEach, expect, it, vi } from "vitest";
import { devicePushState, enableDevicePush } from "./device-push";
import {
  androidPairingLink,
  androidPushStatus,
  supportsNativePush,
} from "./android";

vi.mock("./android", () => ({
  supportsNativePush: vi.fn(),
  androidPushStatus: vi.fn(),
  androidPairingLink: vi.fn(),
}));

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

it("does not offer browser notifications even with browser permission granted", async () => {
  const requestPermission = vi.fn();
  const register = vi.fn();
  vi.stubGlobal("Notification", { permission: "granted", requestPermission });
  vi.stubGlobal("navigator", { serviceWorker: { register } });
  vi.mocked(supportsNativePush).mockReturnValue(false);
  expect(await devicePushState()).toMatchObject({
    supported: false,
    native: false,
  });
  await expect(enableDevicePush()).rejects.toThrow("Android app");
  expect(requestPermission).not.toHaveBeenCalled();
  expect(register).not.toHaveBeenCalled();
  expect(androidPushStatus).not.toHaveBeenCalled();
});

it("continues native Android notification pairing", async () => {
  vi.mocked(supportsNativePush).mockReturnValue(true);
  vi.mocked(androidPushStatus).mockResolvedValue({
    configured: true,
    subscribed: false,
    project_id: "fixture",
  });
  vi.mocked(androidPairingLink).mockResolvedValue(
    "intent://notifications/connect",
  );
  expect(await devicePushState()).toMatchObject({
    supported: true,
    native: true,
    permission: "default",
  });
  expect(await enableDevicePush()).toBe("intent://notifications/connect");
});
