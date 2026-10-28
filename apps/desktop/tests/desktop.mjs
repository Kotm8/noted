import { createRequire } from "node:module";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";

const require = createRequire(new URL("../../web/package.json", import.meta.url));
const { chromium, expect } = require("@playwright/test");
const [port, temporary, phase] = process.argv.slice(2);
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
const context = browser.contexts()[0];
const downloads = await browser.newBrowserCDPSession();
await downloads.send("Browser.setDownloadBehavior", { behavior: "default", eventsEnabled: true });
const page = context.pages()[0] ?? await context.waitForEvent("page");
page.setDefaultTimeout(15000);
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const screenshots = resolve("../../.local");

try {
  if (!phase) {
    await page.getByLabel("Server address", { exact: true }).fill("http://example.com");
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Use HTTPS");
    await page.screenshot({ path: resolve(screenshots, "desktop-connect.png") });
    await page.getByLabel("Server address", { exact: true }).fill("http://localhost:8000");
    await page.getByRole("button", { name: "Connect", exact: true }).click();
  }
  if (!phase) {
    await expect(page.getByLabel("Username", { exact: true })).toBeVisible();
    await page.getByLabel("Username", { exact: true }).fill("ilya");
    await page.getByLabel("Password", { exact: true }).fill("browser-test-password-only");
    await expect(page.getByRole("checkbox", { name: "Keep me signed in" })).toBeChecked();
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    const startup = page.getByRole("dialog", { name: "Start Noted with Windows?" });
    await startup.getByRole("button", { name: "Not now", exact: true }).click();
    await expect(startup).toHaveCount(0);
    const preferences = JSON.parse(await readFile(resolve(temporary, "profile/startup.json"), "utf8"));
    assert.equal(preferences.asked, true);
  }
  await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible();
  const startupStyle = await page.request.get(new URL("/startup.css", page.url()).href);
  assert.equal(startupStyle.status(), 200);
  await page.getByRole("button", { name: "Full calendar", exact: true }).click();
  await expect(page.locator(".schedule-grid")).toBeVisible();
  await page.locator(".workspace-rail").getByRole("button", { name: "Home", exact: true }).click();

  const logo = page.getByRole("button", { name: "Noted", exact: true });
  for (let click = 0; click < 6; click++) await logo.click();
  await expect(page.getByRole("dialog", { name: "Diagnostics" })).toHaveCount(0);
  await logo.click();
  const diagnostics = page.getByRole("dialog", { name: "Diagnostics" });
  await expect(diagnostics).toBeVisible();
  await expect(diagnostics.getByText("Desktop", { exact: true })).toBeVisible();
  await expect(diagnostics.getByText(/^ready \(/)).toBeVisible();
  await expect(diagnostics.getByText("Unavailable in this client")).toBeVisible();
  await expect(diagnostics.getByRole("button", { name: "Test this device" })).toBeDisabled();
  await diagnostics.getByRole("button", { name: "Refresh app data" }).click();
  await expect(diagnostics.getByText("App data refreshed.")).toBeVisible();
  await page.screenshot({ path: resolve(screenshots, "desktop-diagnostics.png") });
  await page.keyboard.press("Escape");
  await expect(diagnostics).toHaveCount(0);

  const call = async (path, method = "GET", body) => page.evaluate(async ({ path, method, body }) => {
    const name = `noted_csrf_${location.port}=`;
    const csrf = document.cookie.split("; ").find((entry) => entry.startsWith(name))?.slice(name.length);
    const response = await fetch(path, { method, headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
    return response.json();
  }, { path, method, body });

  if (phase === "reconnect") {
    await page.locator(".home-project-navigation").getByRole("button", { name: "Desktop check", exact: true }).click();
    await expect(page.locator(".note").filter({ hasText: "Native desktop persistence" })).toBeVisible();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Start Noted with Windows?" })).toHaveCount(0);
    await page.getByRole("button", { name: "Desktop app", exact: true }).click();
    await expect(page.locator(".desktop-server-address")).toHaveText("http://localhost:8000");
    await page.getByRole("button", { name: "Switch server", exact: true }).click();
    await expect(page.getByLabel("Server address", { exact: true })).toBeVisible();
    const profile = JSON.parse(await readFile(resolve(temporary, "profile/connection.json"), "utf8"));
    assert.equal(profile.serverUrl, null);
    assert.deepEqual(errors, []);
    console.log("PASS: native app restart securely restored sign-in, retained notes, and switched servers.");
  } else {
    const origin = new URL(page.url()).origin;
    const desktopUpdate = await call("/desktop/updates");
    assert.equal(desktopUpdate.supported, true);
    assert.equal(desktopUpdate.phase, "idle");
    assert.equal(desktopUpdate.current_version, "0.3.0");
    assert.equal((await fetch(`${origin}/desktop/updates`)).status, 403);
    const updateForgery = await page.evaluate(async () => {
      const response = await fetch("/desktop/updates", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": "wrong" },
        body: JSON.stringify({ action: "install", version: "9.9.9" }),
      });
      return response.status;
    });
    assert.equal(updateForgery, 403);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Desktop app", exact: true }).click();
    await expect(page.getByText("Installed version: 0.3.0", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Check for updates", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Restart and install", exact: true })).toHaveCount(0);
    await page.screenshot({ path: resolve(screenshots, "desktop-app-updates.png") });
    await page.keyboard.press("Escape");
    const unauthenticated = await fetch(`${origin}/api/v1/auth/session`);
    assert.equal(unauthenticated.status, 403);
    const cookieNames = (await context.cookies()).map((cookie) => cookie.name);
    assert(!cookieNames.includes("noted_session"));
    assert(!cookieNames.includes("noted_csrf"));
    const forged = await page.evaluate(async () => {
      const response = await fetch("/api/v1/workspaces", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": "wrong" }, body: '{"name":"forged"}' });
      return response.status;
    });
    assert.equal(forged, 403);

    const workspace = await call("/api/v1/workspaces", "POST", { name: "Desktop check", icon: "N" });
    const channel = await call(`/api/v1/workspaces/${workspace.id}/channels`, "POST", { name: "native-client" });
    await page.goto(`${origin}/w/${workspace.id}/c/${channel.id}`);
    const composer = page.getByRole("textbox", { name: "Message native-client" });
    await composer.fill("Native desktop persistence");
    await composer.press("Enter");
    await expect(page.locator(".note").filter({ hasText: "Native desktop persistence" })).toBeVisible();
    const payload = Buffer.alloc(1024 * 1024, 42);
    await page.getByLabel("Attach files", { exact: true }).setInputFiles({ name: "native-file.bin", mimeType: "application/octet-stream", buffer: payload });
    await page.getByRole("button", { name: "Send note", exact: true }).click();
    await expect(page.locator(".file-attachment")).toContainText("native-file.bin");
    const messages = await call(`/api/v1/channels/${channel.id}/messages`);
    const attachment = messages.items.flatMap((message) => message.attachments)[0];
    const downloaded = await page.evaluate(async (url) => {
      const response = await fetch(url);
      const buffer = new Uint8Array(await response.arrayBuffer());
      return { status: response.status, size: buffer.length, valid: buffer.every((b) => b === 42) };
    }, attachment.download_url);
    assert.deepEqual(downloaded, { status: 200, size: payload.length, valid: true });

    await page.getByLabel("Attach files", { exact: true }).setInputFiles(resolve("../../backend/tests/fixtures/video.mp4"));
    await page.getByRole("button", { name: "Send note", exact: true }).click();
    const video = page.locator("video");
    await expect(video).toBeVisible();
    await expect.poll(() => video.evaluate((element) => element.readyState)).toBeGreaterThanOrEqual(1);
    const src = await video.getAttribute("src");
    const ranged = await page.evaluate(async (url) => {
      const response = await fetch(url, { headers: { Range: "bytes=0-63" } });
      return { status: response.status, size: (await response.arrayBuffer()).byteLength };
    }, src);
    assert.deepEqual(ranged, { status: 206, size: 64 });
    await video.evaluate(async (element) => { element.muted = true; await element.play(); });
    await expect.poll(() => video.evaluate((element) => element.currentTime)).toBeGreaterThan(0);
    await video.evaluate((element) => element.pause());
    await page.screenshot({ path: resolve(screenshots, "desktop-notes.png") });

    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Backups", exact: true }).click();
    await page.getByRole("button", { name: "Generate backup ZIP", exact: true }).click();
    await page.getByRole("link", { name: "Download backup ZIP", exact: true }).click();
    await expect.poll(async () => (await readdir(resolve(temporary, "downloads"))).filter((file) => file.endsWith(".zip")).length, { timeout: 20000 }).toBe(1);
    await page.screenshot({ path: resolve(screenshots, "desktop-backup.png") });
    const profile = JSON.parse(await readFile(resolve(temporary, "profile/connection.json"), "utf8"));
    assert.equal(profile.serverUrl, "http://localhost:8000");
    assert.deepEqual(Object.keys(profile).sort(), ["gatewayPort", "serverUrl"]);
    await page.getByRole("button", { name: "Close dialog" }).click();
    assert.deepEqual(errors, []);
    console.log("PASS: real WebView2 connection, login, native-only server cookies, CSRF rejection, notes, streamed file, video playback/ranges, and backup download.");
  }
} finally {
  if (errors.length) console.error(errors);
  await page.screenshot({ path: resolve(screenshots, "desktop-last-state.png") }).catch(() => {});
  await browser.close();
}
