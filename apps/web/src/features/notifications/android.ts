import { ApiError, request } from "../../lib/http";

export function initializeAndroidClient() {
  const url = new URL(window.location.href);
  if (url.searchParams.get("client") !== "android") return;
  sessionStorage.setItem("noted.android-client", "browser");
  url.searchParams.delete("client");
  window.history.replaceState(window.history.state, "", url);
}

export const isAndroidApp = () =>
  sessionStorage.getItem("noted.android-client") === "browser";

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
}
