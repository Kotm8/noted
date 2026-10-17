import { request } from "../../lib/http";

export const supportsPush = () =>
  import.meta.env.MODE !== "desktop" &&
  window.isSecureContext &&
  "Notification" in window &&
  "serviceWorker" in navigator &&
  "PushManager" in window;

export async function pushPermission(): Promise<NotificationPermission> {
  return "Notification" in window ? Notification.permission : "denied";
}

export function createDeviceId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function notificationDevice() {
  let id = localStorage.getItem("noted.notification-device");
  if (!id) {
    id = createDeviceId();
    localStorage.setItem("noted.notification-device", id);
  }
  return {
    device_id: id,
    kind: /Android|iPhone|iPad/i.test(navigator.userAgent)
      ? "mobile"
      : "desktop",
  };
}

export async function registerPush() {
  const registration = await navigator.serviceWorker.register(
    "/notifications-sw.js",
    { scope: "/" },
  );
  await navigator.serviceWorker.ready;
  const { public_key } = await request<{ public_key: string }>(
    "/notifications/config",
  );
  const bytes = Uint8Array.from(
    atob(
      public_key.replace(/-/g, "+").replace(/_/g, "/") +
        "=".repeat((4 - (public_key.length % 4)) % 4),
    ),
    (char) => char.charCodeAt(0),
  );
  let existing = await registration.pushManager.getSubscription();
  const existingKey = existing?.options.applicationServerKey;
  if (
    existing &&
    existingKey &&
    !new Uint8Array(existingKey).every((byte, index) => byte === bytes[index])
  ) {
    await existing.unsubscribe();
    existing = null;
  }
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: bytes,
    }));
  await request("/notifications/subscriptions", "POST", {
    ...subscription.toJSON(),
    ...notificationDevice(),
  });
}

export async function enablePush() {
  if (!supportsPush())
    throw new Error(
      "Browser notifications require HTTPS and a browser with Web Push support.",
    );
  const permission = await Notification.requestPermission();
  if (permission !== "granted")
    throw new Error(
      "Notifications are blocked. You can change this in the browser's site settings.",
    );
  await registerPush();
  localStorage.removeItem("noted.push-disabled");
}

export async function disablePush() {
  await request(
    `/notifications/subscriptions/${notificationDevice().device_id}`,
    "DELETE",
  );
  const registration = await navigator.serviceWorker.getRegistration("/");
  await (await registration?.pushManager.getSubscription())?.unsubscribe();
  localStorage.setItem("noted.push-disabled", "yes");
}
