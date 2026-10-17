import { expect, test } from "@playwright/test";

test("hosting controls separate transfer and domain change and require exact deletion confirmation", async ({
  page,
}) => {
  const state: { job: Record<string, unknown> | null } = { job: null };
  let removals = 0;
  const makeJob = (action: string, values: Record<string, unknown> = {}) => ({
    id: "8e17cd40-637b-45a8-aef5-546f239f2ea2",
    action,
    status: "succeeded",
    phase: "complete",
    detail: "Completed for browser testing.",
    destination: null,
    ip: null,
    host_key: null,
    fingerprint: null,
    ...values,
  });
  await page.route("**/api/v1/host/status", (route) =>
    route.fulfill({
      json: {
        configured: true,
        worker_online: true,
        capable: true,
        instance_id: "browser-instance",
        job: state.job,
      },
    }),
  );
  await page.route("**/api/v1/host/domain", (route) => {
    expect(route.request().postDataJSON()).toEqual({
      domain: "new.example.com",
      current_password: "browser-test-password-only",
      dns_confirmed: true,
    });
    state.job = makeJob("domain", { destination: "https://new.example.com" });
    return route.fulfill({ status: 202, json: state.job });
  });
  await page.route("**/api/v1/host/probe", (route) => {
    state.job = makeJob("probe", {
      host_key: "ssh-ed25519 fixture-public-key",
      fingerprint: "SHA256:fixture-fingerprint",
      ip: "1.1.1.1",
    });
    return route.fulfill({ status: 202, json: state.job });
  });
  await page.route("**/api/v1/host/transfer", (route) => {
    const data = route.request().postDataJSON();
    expect(data.ip).toBe("1.1.1.1");
    expect(data.host_key).toBe("ssh-ed25519 fixture-public-key");
    expect(data.pause_confirmed).toBe(true);
    state.job = makeJob("transfer", {
      status: "waiting_dns",
      phase: "waiting_dns",
      ip: "1.1.1.1",
      destination: "https://notes.example.com",
      detail: "The destination is ready. Change DNS to the new IP.",
    });
    return route.fulfill({ status: 202, json: state.job });
  });
  await page.route("**/api/v1/host/cancel-transfer", (route) => {
    state.job = makeJob("cancel", {
      status: "cancelled",
      detail: "Source writes are available again.",
    });
    return route.fulfill({ status: 202, json: state.job });
  });
  await page.route("**/api/v1/host/remove", (route) => {
    expect(route.request().postDataJSON()).toEqual({
      confirmation: "I LOVE VERITY",
      current_password: "browser-test-password-only",
      instance_id: "browser-instance",
    });
    removals++;
    return route.fulfill({ status: 202, json: makeJob("remove", { status: "queued" }) });
  });
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill("ilya");
  await page.getByLabel("Password", { exact: true }).fill("browser-test-password-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Server", exact: true }).click();
  await page.getByRole("button", { name: "Switch domain", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "Switch domain", exact: true });
  await dialog.getByLabel("New domain", { exact: true }).fill("new.example.com");
  await dialog.getByLabel("The new DNS record points to this VPS.").check();
  await dialog
    .getByLabel("Current owner password", { exact: true })
    .fill("browser-test-password-only");
  await dialog.getByRole("button", { name: "Switch domain", exact: true }).click();
  await expect(page.getByRole("link", { name: "Open https://new.example.com" })).toBeVisible();
  await page.getByRole("button", { name: "Transfer VPS", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Transfer VPS", exact: true });
  await dialog.getByLabel("Destination public IP", { exact: true }).fill("1.1.1.1");
  await dialog.getByRole("button", { name: "Read SSH host key", exact: true }).click();
  await expect(dialog.getByText("SHA256:fixture-fingerprint", { exact: true })).toBeVisible();
  await dialog.getByLabel("The fingerprint matches the destination VPS.").check();
  await dialog
    .getByLabel("Destination root password", { exact: true })
    .fill("fixture-ssh-password");
  await dialog
    .getByLabel("Destination owner password", { exact: true })
    .fill("fixture-destination-password");
  await dialog
    .getByLabel("Confirm destination password", { exact: true })
    .fill("fixture-destination-password");
  await dialog
    .getByLabel("Current owner password", { exact: true })
    .fill("browser-test-password-only");
  await dialog
    .getByLabel(
      "I understand that source writes stay paused while I update DNS and verify the new server.",
    )
    .check();
  await page.screenshot({ path: "../../.local/screenshots/vps-transfer.png", fullPage: true });
  await dialog.getByRole("button", { name: "Start VPS transfer", exact: true }).click();
  await expect(page.getByText("The destination is ready. Change DNS to the new IP.")).toBeVisible();
  await page.getByText("Cancel transfer and restore source writes", { exact: true }).click();
  await page
    .getByLabel("Current owner password", { exact: true })
    .fill("browser-test-password-only");
  await page.getByRole("button", { name: "Cancel transfer", exact: true }).click();
  await page.getByRole("button", { name: "Delete Noted from this VPS", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Permanently delete this server", exact: true });
  const remove = dialog.getByRole("button", {
    name: "Permanently delete Noted and its data",
    exact: true,
  });
  await expect(remove).toBeDisabled();
  await dialog
    .getByLabel("I have saved any backup I need and understand that this deletion is permanent.")
    .check();
  await dialog
    .getByLabel("Current owner password", { exact: true })
    .fill("browser-test-password-only");
  await dialog.getByLabel("Server deletion confirmation", { exact: true }).fill("I LOVE VERITY ");
  await expect(remove).toBeDisabled();
  expect(removals).toBe(0);
  await dialog.getByLabel("Server deletion confirmation", { exact: true }).fill("I LOVE VERITY");
  await page.screenshot({ path: "../../.local/screenshots/danger-zone.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await remove.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: "../../.local/screenshots/danger-zone-mobile.png",
    fullPage: true,
  });
  await remove.click();
  await expect(dialog.getByText("The VPS itself and unrelated apps are kept.")).toBeVisible();
  expect(removals).toBe(1);
});
