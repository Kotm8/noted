import { ApiError, request } from "../../lib/http";

export function initializeAndroidClient() {
  const url = new URL(window.location.href);
  if (url.searchParams.get("client") !== "android") return;
  sessionStorage.setItem("noted.android-client", "browser");
  if (url.searchParams.get("nativePush") === "1")
    sessionStorage.setItem("noted.android-native-push", "1");
  else sessionStorage.removeItem("noted.android-native-push");
  url.searchParams.delete("client");
  url.searchParams.delete("nativePush");
  url.searchParams.delete("notificationSetup");
  window.history.replaceState(window.history.state, "", url);
}

export const isAndroidApp = () =>
  sessionStorage.getItem("noted.android-client") === "browser";

export const supportsNativePush = () =>
  isAndroidApp() && sessionStorage.getItem("noted.android-native-push") === "1";

export interface AndroidPushStatus {
  configured: boolean;
  subscribed: boolean;
  project_id: string | null;
}

export async function androidPushStatus(deviceId?: string) {
  return request<AndroidPushStatus>(
    `/notifications/android/status${deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : ""}`,
  );
}

export async function androidPairingLink(deviceId: string): Promise<string> {
  const result = await request<{ ticket: string }>(
    "/notifications/android/pairings",
    "POST",
    { device_id: deviceId },
  );
  const parameters = new URLSearchParams({
    origin: window.location.origin,
    ticket: result.ticket,
  });
  return `intent://notifications/connect?${parameters.toString()}#Intent;scheme=noted;package=com.noted.android;end`;
}

export const androidConnectionUrl =
  "intent://connection#Intent;scheme=noted;package=com.noted.android;end";

export async function disconnectAndroid() {
  const device = localStorage.getItem("noted.notification-device");
  if (device) {
    try {
      await request(`/notifications/subscriptions/${device}`, "DELETE");
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) throw error;
    }
  }
  const registration = await navigator.serviceWorker?.getRegistration("/");
  await (await registration?.pushManager.getSubscription())?.unsubscribe();
  try {
    await request("/auth/logout", "POST");
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
  }
  localStorage.setItem("noted.push-disabled", "yes");
  sessionStorage.removeItem("noted.android-client");
  sessionStorage.removeItem("noted.android-native-push");
}
