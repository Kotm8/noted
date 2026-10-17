import { afterEach, describe, expect, it, vi } from "vitest";
import { collectDiagnostics, testDeviceNotification } from "./diagnostics";

const originalServiceWorker = Object.getOwnPropertyDescriptor(navigator, "serviceWorker");

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  if (originalServiceWorker) Object.defineProperty(navigator, "serviceWorker", originalServiceWorker);
  else Reflect.deleteProperty(navigator, "serviceWorker");
});

describe("diagnostic reports", () => {
  it("copies only selected health fields, excluding server and subscription secrets", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ status: "ready", version: "0.2.0", api_version: 1, password: "server-secret", instance_id: "private-instance" }),
    })));
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: {
      getRegistration: vi.fn(async () => ({ active: {}, pushManager: {
        getSubscription: async () => ({ endpoint: "private-push-endpoint", keys: { auth: "private-auth-key" } }),
      } })),
    } });
    const report = await collectDiagnostics();
    expect(report.checks.find((check) => check.label === "Push subscription")?.value).toBe("Present on this device");
    const json = JSON.stringify(report);
    expect(json).toContain("v0.2.0 / API 1");
    for (const secret of ["server-secret", "private-instance", "private-push-endpoint", "private-auth-key"]) {
      expect(json).not.toContain(secret);
    }
  });

  it("reports unreachable and unhealthy services without leaking response bodies", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockRejectedValueOnce(new Error("private-hostname"))
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({ detail: "database-password" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ version: "0.2.0", api_version: 1 }) }));
    const report = await collectDiagnostics();
    expect(report.checks[0]).toMatchObject({ state: "error", value: "Unreachable or timed out" });
    expect(report.checks[1]).toMatchObject({ state: "error", value: "HTTP 503" });
    expect(JSON.stringify(report)).not.toMatch(/private-hostname|database-password/);
  });

  it("never requests notification permission as a side effect of testing", async () => {
    const requestPermission = vi.fn();
    vi.stubGlobal("Notification", { permission: "default", requestPermission });
    await expect(testDeviceNotification()).rejects.toThrow("Enable notifications in Settings first.");
    expect(requestPermission).not.toHaveBeenCalled();
  });
});
