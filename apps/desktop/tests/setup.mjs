import { createRequire } from "node:module";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";

const require = createRequire(new URL("../../web/package.json", import.meta.url));
const { chromium, expect } = require("@playwright/test");
const [debugPort, sshPort, directory] = process.argv.slice(2);
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
const page = browser.contexts()[0].pages()[0];
page.setDefaultTimeout(20000);
const requests = [];
page.on("request", (request) => {
  if (request.url().includes("/desktop/setup")) requests.push({ path: new URL(request.url()).pathname, body: request.postData() });
});

try {
  await page.getByRole("button", { name: "Set up a new server" }).click();
  await page.getByLabel("Server name", { exact: true }).fill("My notes");
  await page.getByLabel("Server IP", { exact: true }).fill("127.0.0.1");
  await page.getByLabel("SSH port", { exact: true }).fill(sshPort);
  await page.getByLabel("SSH password", { exact: true }).fill("noted-fixture-password");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "A home for your notes" })).toBeVisible();
  await page.getByLabel("Domain", { exact: true }).fill("notes.example.com");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Username", { exact: true }).fill("owner");
  await page.getByLabel("Password", { exact: true }).fill("owner-password-only-for-tests");
  await page.getByLabel("Confirm password", { exact: true }).fill("owner-password-only-for-tests");
  await page.getByLabel("Release repository").fill("noted-installer-fixture-not-published/no-release");
  await page.getByRole("button", { name: "Review setup" }).click();
  await expect(page.getByRole("alert")).toContainText("Publish the Noted release files", { timeout: 75000 });
  await page.screenshot({ path: resolve("../../.local/desktop-setup-release-error.png") });
  const identity = requests.find((request) => request.path.endsWith("/host"));
  assert.deepEqual(JSON.parse(identity.body), { ip: "127.0.0.1", port: Number(sshPort) });
  assert(!JSON.stringify(requests).includes("noted-fixture-password"));
  assert(!JSON.stringify(requests).includes("owner-password-only-for-tests"));
  assert(!requests.some((request) => request.path === "/desktop/setup" && request.body));
  assert.equal(await access(resolve(directory, "profile/setup.json")).then(() => true, () => false), false);

  await page.route("**/desktop/setup/release", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ version: "0.1.0-preview", commit: "a".repeat(40), manifestSha256: "b".repeat(64) }),
  }));
  await page.getByRole("button", { name: "Review setup" }).click();
  await expect(page.getByRole("heading", { name: "Review your setup" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Install on server" })).toBeDisabled();
  await expect(page.locator(".installation-review code")).toContainText("SHA256:");
  await page.screenshot({ path: resolve("../../.local/desktop-setup-review.png") });
  const profile = JSON.parse(await readFile(resolve(directory, "profile/connection.json"), "utf8"));
  assert.equal(profile.serverUrl, null);
  await page.getByRole("checkbox", { name: "I verified this SSH fingerprint with my VPS." }).check();
  await page.getByRole("button", { name: "Install on server" }).click();
  await expect(page.getByRole("heading", { name: "Setup needs attention." })).toBeVisible({ timeout: 75000 });
  await page.getByRole("button", { name: "Clean Noted from VPS" }).click();
  await page.getByLabel("Root SSH password", { exact: true }).fill("noted-fixture-password");
  await page.getByRole("button", { name: "Inspect Noted installation" }).click();
  await expect(page.getByText("Unfinished Noted setup", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Permanently remove Noted" })).toBeDisabled();
  await page.screenshot({ path: resolve("../../.local/desktop-cleanup.png") });
  await page.getByRole("checkbox", { name: "I have saved any backup I need and understand that deletion is permanent." }).check();
  await page.getByLabel("Setup cleanup confirmation").fill("I LOVE VERITY");
  await page.getByRole("button", { name: "Permanently remove Noted" }).click();
  await expect(page.getByRole("heading", { name: "Your server", exact: true })).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole("alert")).toContainText("Unrelated files remain");
  await expect(page.getByLabel("SSH password", { exact: true })).toHaveValue("");
  const cleaned = JSON.parse(await readFile(resolve(directory, "profile/setup.json"), "utf8"));
  assert.equal(cleaned.status, "cleaned");
  assert.equal(cleaned.plan, null);
  assert(!JSON.stringify(cleaned).includes("noted-fixture-password"));
  await page.screenshot({ path: resolve("../../.local/desktop-cleaned.png") });
  console.log("PASS: native cleanup inspected and removed the fixture over pinned SSH, required confirmation, retained unrelated files, and reset setup.");
  console.log("PASS: native setup wizard read a real SSH fingerprint, handled an unpublished release before installation, and required host-key confirmation. Review screenshot uses fixture release metadata.");
} finally {
  await browser.close();
}
