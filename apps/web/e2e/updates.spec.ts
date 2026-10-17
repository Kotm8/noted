import { expect, test } from "@playwright/test";

test("server updates require an explicit install and reconnect to the existing job", async ({
  page,
}) => {
  const release = {
    commit: "b".repeat(40),
    version: "0.1.1-main.bbbbbbbbbbbb",
    sequence: 2,
    manifest_sha256: "c".repeat(64),
    notes: "Faster search and quieter evenings.",
    url: "https://github.com/example/noted/releases/tag/main-example",
    published_at: new Date().toISOString(),
  };
  const state: { job: null | Record<string, unknown> } = { job: null };
  let installs = 0;
  let checks = 0;
  let checkedAt = new Date().toISOString();
  await page.route("**/api/v1/updates/status", (route) =>
    route.fulfill({
      json: {
        configured: true,
        worker_online: true,
        repository: "example/noted",
        installed: {
          commit: "a".repeat(40),
          version: "0.1.0",
          sequence: 1,
          schema: "0003_attachment_order",
        },
        latest: release,
        available: true,
        last_checked: checkedAt,
        check_error: null,
        download_commit: release.commit,
        download_status: "ready",
        download_error: null,
        job: state.job,
      },
    }),
  );
  await page.route("**/api/v1/updates/check", (route) => {
    checks++;
    checkedAt = new Date(Date.now() + 1000).toISOString();
    return route.fulfill({ status: 202, json: { status: "queued" } });
  });
  await page.route("**/api/v1/updates/apply", (route) => {
    expect(route.request().postDataJSON()).toEqual({
      commit: release.commit,
      manifest_sha256: release.manifest_sha256,
    });
    installs++;
    state.job = {
      id: "a7be651f-d0d6-47cd-8cb2-089c5d12d4b2",
      status: "queued",
      phase: "queued",
      commit: release.commit,
      detail: "Waiting for the server update worker.",
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      finished_at: null,
    };
    return route.fulfill({ status: 202, json: state.job });
  });
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill("ilya");
  await page.getByLabel("Password", { exact: true }).fill("browser-test-password-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Update available")).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Server", exact: true }).click();
  await expect(page.getByText("Downloaded and ready to install")).toBeVisible();
  await page.getByRole("button", { name: "Check for updates", exact: true }).click();
  await expect.poll(() => checks).toBe(1);
  await expect(page.getByRole("button", { name: "Check for updates", exact: true })).toBeEnabled();
  expect(installs).toBe(0);
  await page.getByRole("button", { name: "Update server", exact: true }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(installs).toBe(0);
  await page.screenshot({ path: "../../.local/screenshots/server-updates.png", fullPage: true });
  await page.getByRole("button", { name: "Update server", exact: true }).click();
  await page.getByRole("button", { name: "Install update", exact: true }).click();
  await expect(page.getByText("Waiting for the server update worker.")).toBeVisible();
  expect(installs).toBe(1);
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Server", exact: true }).click();
  await expect(page.getByRole("button", { name: "Update server", exact: true })).toBeDisabled();
  state.job = {
    ...state.job,
    status: "succeeded",
    phase: "complete",
    detail: "Update installed. Reload the app to use the new version.",
  };
  await expect(page.getByRole("button", { name: "Reload app", exact: true })).toBeVisible();
  expect(installs).toBe(1);
});
