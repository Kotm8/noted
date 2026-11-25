import { ApiError, request } from "../../lib/http";
import { androidPilot, isAndroidPilot } from "../../lib/android-pilot";
import {
  androidPairingLink,
  androidPushStatus,
  supportsNativePush,
} from "./android";
import { notificationDevice } from "./device";

export interface DevicePushState {
  native: boolean;
  supported: boolean;
  permission: "default" | "granted" | "denied";
  paired?: boolean;
}

export async function devicePushState(): Promise<DevicePushState> {
  if (isAndroidPilot) {
    const device = await androidPilot.notificationState();
    const status = await androidPushStatus(device.deviceId);
    const paired = status.subscribed && device.paired;
    return {
      native: true,
      supported: status.configured,
      permission:
        device.permission === "granted" && !paired
          ? "default"
          : device.permission,
      paired,
    };
  }
  if (supportsNativePush()) {
    try {
      const status = await androidPushStatus(notificationDevice().device_id);
      if (status.configured)
        return {
          native: true,
          supported: true,
          permission: status.subscribed ? "granted" : "default",
        };
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 404) throw error;
    }
  }
  return {
    native: false,
    supported: false,
    permission: "denied",
  };
}

export async function enableDevicePush(): Promise<string | null> {
  if (isAndroidPilot) {
    await androidPilot.enableNotifications();
    localStorage.removeItem("noted.push-disabled");
    return null;
  }
  const state = await devicePushState();
  if (state.native) {
    const link = await androidPairingLink(notificationDevice().device_id);
    localStorage.removeItem("noted.push-disabled");
    return link;
  }
  throw new Error("Enable notifications in the Android app.");
}

export async function disableDevicePush() {
  if (isAndroidPilot) await androidPilot.disableNotifications();
  else
    await request(
      `/notifications/subscriptions/${notificationDevice().device_id}`,
      "DELETE",
    );
  localStorage.setItem("noted.push-disabled", "yes");
}
