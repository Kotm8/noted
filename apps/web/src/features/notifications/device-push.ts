import { ApiError } from "../../lib/http";
import {
  androidPairingLink,
  androidPushStatus,
  supportsNativePush,
} from "./android";
import {
  enablePush,
  notificationDevice,
  pushPermission,
  supportsPush,
} from "./browser";

export interface DevicePushState {
  native: boolean;
  supported: boolean;
  permission: NotificationPermission;
}

export async function devicePushState(): Promise<DevicePushState> {
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
    supported: supportsPush(),
    permission: await pushPermission(),
  };
}

export async function enableDevicePush(): Promise<string | null> {
  const state = await devicePushState();
  if (state.native) {
    const link = await androidPairingLink(notificationDevice().device_id);
    localStorage.removeItem("noted.push-disabled");
    return link;
  }
  await enablePush();
  return null;
}
