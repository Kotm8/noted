import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, test, type Page } from "./fixtures";

const execute = promisify(execFile);

async function api(page: Page, path: string, method = "GET", body?: unknown) {
  return page.evaluate(
    async ({ path, method, body }) => {
      const csrf =
        document.cookie
          .split("; ")
          .find((cookie) => cookie.startsWith("noted_csrf="))
          ?.slice(11) ?? "";
      const response = await fetch(`/api/v1${path}`, {
        method,
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!response.ok) throw new Error(await response.text());
      return response.status === 204 ? null : response.json();
    },
    { path, method, body },
  );
}

async function choose(page: Page, label: string, option: string) {
  await page.getByRole("button", { name: label, exact: true }).click();
  await page.getByRole("menuitemradio", { name: option, exact: true }).click();
}

test("writing nudges save activity defaults, open the channel, and clear after writing", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill("ilya");
  await page
    .getByLabel("Password", { exact: true })
    .fill("browser-test-password-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".app-shell")).toBeVisible();
  const project = await api(page, "/workspaces", "POST", { name: "Writing" });
  const channel = await api(
    page,
    `/workspaces/${project.id}/channels`,
    "POST",
    { name: "progress" },
  );
  await page.goto(`/w/${project.id}/c/${channel.id}`);
  await page
    .getByRole("button", { name: "Choose current activity", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Manage activities", exact: true })
    .click();
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await settings
    .getByRole("button", { name: "New activity", exact: true })
    .click();
  await settings.getByLabel("Activity name", { exact: true }).fill("Building");
  await choose(page, "Writing nudges", "Every N minutes of tracked time");
  await settings.getByLabel("Nudge interval in minutes").fill("15");
  await choose(page, "Nudge channel", "Writing / #progress");
  await settings
    .getByLabel("Message", { exact: true })
    .fill("Write a progress update");
  await settings
    .getByLabel("Also nudge when I stop or switch activity")
    .uncheck();
  await page.screenshot({ path: "../../.local/writing-nudges-settings.png" });
  await settings
    .getByRole("button", { name: "Add activity", exact: true })
    .click();
  await expect(settings.locator(".tracking-activity-form")).toHaveCount(0);
  const activities = await api(page, "/time-tracking/activities");
  const activity = activities.find(
    (item: { name: string }) => item.name === "Building",
  );
  expect(activity.writing_nudge.interval_minutes).toBe(15);
  expect(activity.writing_nudge.channel_id).toBe(channel.id);
  await settings
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  const state = await api(page, "/time-tracking/tracker");
  await api(page, "/time-tracking/tracker", "POST", {
    action: "start",
    activity_id: activity.id,
    revision: state.revision,
    request_id: crypto.randomUUID(),
  });
  await execute(
    process.env.NOTED_BROWSER_TEST_PYTHON!,
    ["-m", "tests.browser_nudges"],
    {
      cwd: fileURLToPath(new URL("../../../backend/", import.meta.url)),
      env: process.env,
    },
  );
  await expect(page.locator(".writing-prompt-banner")).toContainText(
    "Write a progress update",
  );
  await page.goto("/");
  await page
    .locator(".home-notification-title")
    .filter({ hasText: "Write a progress update" })
    .click();
  const composer = page.getByRole("textbox", {
    name: "Message progress",
    exact: true,
  });
  await expect(composer).toBeFocused();
  await composer.fill("Shipped the first part.");
  await composer.press("Enter");
  await expect(page.locator(".writing-prompt-banner")).toHaveCount(0);
  const notices = await api(page, "/time-tracking/writing-nudges");
  expect(notices).toEqual([]);
  await page
    .locator(".sidebar-global-navigation")
    .getByRole("button", { name: "Calendar", exact: true })
    .click();
  await page.getByRole("button", { name: "Add plan", exact: true }).click();
  let editor = page.getByRole("dialog", { name: "New plan", exact: true });
  await editor
    .getByLabel("Title", { exact: true })
    .fill("Build with a writing nudge");
  await editor
    .getByRole("button", { name: "More options", exact: true })
    .click();
  editor = page.getByRole("dialog", { name: "New plan", exact: true });
  await expect(
    editor.getByRole("button", { name: "Writing nudges", exact: true }),
  ).toHaveText("Use activity settings");
  await choose(page, "Writing nudges", "Every N minutes of tracked time");
  await editor.getByLabel("Nudge interval in minutes").fill("5");
  await choose(page, "Nudge channel", "Writing / #progress");
  await editor
    .getByLabel("Message", { exact: true })
    .fill("How is the plan going?");
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith("/schedule/plans") &&
      response.request().method() === "POST",
  );
  await editor.getByRole("button", { name: "Add plan", exact: true }).click();
  const plan = await (await saved).json();
  expect(plan.writing_nudge.interval_minutes).toBe(5);
  expect(plan.writing_nudge.content).toBe("How is the plan going?");
  await expect(editor).toBeHidden();
});
