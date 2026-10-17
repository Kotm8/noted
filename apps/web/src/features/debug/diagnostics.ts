import { isAndroidApp } from "../notifications/android";
import { supportsPush } from "../notifications/browser";
import { request } from "../../lib/http";

export interface DiagnosticCheck {
  label: string;
  value: string;
  state: "ok" | "warning" | "error";
}

export interface DiagnosticReport {
  capturedAt: string;
  client: string;
  checks: DiagnosticCheck[];
}

async function serverCheck(path: string, label: string): Promise<DiagnosticCheck> {
  const start = performance.now();
  try {
    const response = await fetch(`/api/v1${path}`, {
      credentials: "same-origin",
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    const data = await response.json();
    if (!response.ok) return { label, value: `HTTP ${response.status}`, state: "error" };
    const detail = path === "/version"
      ? `v${String(data.version).slice(0, 40)} / API ${String(data.api_version).slice(0, 8)}`
      : `${String(data.status).slice(0, 40)} (${Math.round(performance.now() - start)} ms)`;
    return { label, value: detail, state: "ok" };
  } catch {
    return { label, value: "Unreachable or timed out", state: "error" };
  }
}

async function notificationChecks(): Promise<DiagnosticCheck[]> {
  const permission = "Notification" in window ? Notification.permission : "unavailable";
  const checks: DiagnosticCheck[] = [
    {
      label: "Web Push",
      value: supportsPush() ? "Supported" : "Unavailable in this client",
      state: supportsPush() ? "ok" : "warning",
    },
    {
      label: "Notification permission",
      value: permission,
      state: permission === "granted" ? "ok" : "warning",
    },
    {
      label: "Device notifications",
      value: localStorage.getItem("noted.push-disabled") === "yes" ? "Disabled in Noted" : "Not disabled",
      state: localStorage.getItem("noted.push-disabled") === "yes" ? "warning" : "ok",
    },
  ];
  if (!("serviceWorker" in navigator)) return checks;
  try {
    const registration = await navigator.serviceWorker.getRegistration("/");
    const subscribed = Boolean(await registration?.pushManager?.getSubscription());
    checks.push(
      {
        label: "Notification service worker",
        value: registration?.active ? "Active" : "Not active",
        state: registration?.active ? "ok" : "warning",
      },
      {
        label: "Push subscription",
        value: subscribed ? "Present on this device" : "Not subscribed",
        state: subscribed ? "ok" : "warning",
      },
    );
  } catch {
    checks.push({ label: "Push subscription", value: "Could not inspect", state: "error" });
  }
  return checks;
}

export async function collectDiagnostics(): Promise<DiagnosticReport> {
  const [live, ready, version, notifications] = await Promise.all([
    serverCheck("/health/live", "Server connection"),
    serverCheck("/health/ready", "Database readiness"),
    serverCheck("/version", "Server version"),
    notificationChecks(),
  ]);
  return {
    capturedAt: new Date().toISOString(),
    client: import.meta.env.MODE === "desktop" ? "Desktop" : isAndroidApp() ? "Android" : "Web",
    checks: [
      live, ready, version,
      { label: "Network", value: navigator.onLine ? "Online" : "Offline", state: navigator.onLine ? "ok" : "warning" },
      { label: "Secure context", value: window.isSecureContext ? "Yes" : "No", state: window.isSecureContext ? "ok" : "warning" },
      ...notifications,
    ],
  };
}

export async function testDeviceNotification() {
  if (!supportsPush() || Notification.permission !== "granted") {
    throw new Error("Enable notifications in Settings first.");
  }
  const registration = await navigator.serviceWorker.getRegistration("/");
  if (!registration?.active) throw new Error("Enable notifications in Settings to register this device.");
  await registration.showNotification("Noted diagnostic test", {
    body: "Notifications can display on this device. This is a local test, not a server delivery test.",
    icon: "/noted-icon.svg",
    tag: "noted-debug-test",
  });
}

export async function testPhoneNotification(): Promise<string> {
  const result = await request<{ accepted: number; expired: number; failed: number }>("/notifications/test", "POST");
  if (!result.accepted) {
    throw new Error(result.failed
      ? "The push service did not accept the test. Check the server connection and try again."
      : "Phone subscriptions expired. Enable notifications on your phone again.");
  }
  const issues = result.expired || result.failed
    ? ` ${result.expired} expired, ${result.failed} failed.` : "";
  return `Push service accepted the test for ${result.accepted} phone${result.accepted === 1 ? "" : "s"}. Check your phone.${issues}`;
}
