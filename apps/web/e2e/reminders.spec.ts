import { expect, test, type Page } from "@playwright/test";

async function api(page: Page, path: string, method = "GET", body?: unknown) {
  return page.evaluate(
    async ({ path, method, body }) => {
      const csrf =
        document.cookie
          .split("; ")
          .find((cookie) => cookie.startsWith("noted_csrf="))
          ?.split("=")[1] ?? "";
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

test("reminders persist, support keyboard scheduling, snooze, custom pickers and commands", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill("ilya");
  await page
    .getByLabel("Password", { exact: true })
    .fill("browser-test-password-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Create workspace", exact: true }),
  ).toBeVisible();
  const project = await api(page, "/workspaces", "POST", {
    name: "Reminder project",
  });
  const channel = await api(
    page,
    `/workspaces/${project.id}/channels`,
    "POST",
    { name: "reminders", kind: "reminder" },
  );
  await page.goto(`/w/${project.id}/c/${channel.id}`);
  const composer = page.getByRole("textbox", {
    name: "Message reminders",
    exact: true,
  });
  await composer.fill("Remember this thought");
  await composer.press("Enter");
  let dialog = page.getByRole("dialog", {
    name: "When should we remind you?",
    exact: true,
  });
  await expect(
    dialog.getByRole("button", { name: "Send reminder", exact: true }),
  ).toBeFocused();
  await expect(page.locator(".note")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(composer).toHaveValue("Remember this thought");
  await composer.press("Shift+Enter");
  await composer.pressSequentially("Another line");
  await page.keyboard.down("Enter");
  await expect(dialog).toBeVisible();
  await page.keyboard.down("Enter");
  await expect(dialog).toBeVisible();
  await page.keyboard.up("Enter");
  await page.keyboard.press("Enter");
  await expect(dialog).not.toBeVisible();
  await expect(page.locator(".note")).toHaveCount(1);
  await expect(page.locator(".reminder-countdown")).toContainText("Time left");
  await expect(page.locator(".reminder-time")).toContainText("Rings");
  await page.reload();
  await expect(page.locator(".reminder-countdown")).toContainText("Time left");
  await page.getByRole("checkbox", { name: "Complete reminder" }).check();
  await expect(page.locator(".reminder-countdown")).toHaveText("Done");
  await page.getByRole("checkbox", { name: "Restore reminder" }).uncheck();
  await expect(page.locator(".reminder-countdown")).toContainText("Time left");
  await page.getByRole("button", { name: "Choose snooze duration" }).click();
  await page.getByRole("menuitem", { name: "30 minutes", exact: true }).click();
  await expect(page.locator(".reminder-countdown")).toContainText(/(29m|30m)/);
  await page.locator(".reminder-time").click();
  dialog = page.getByRole("dialog", {
    name: "When should we remind you?",
    exact: true,
  });
  await dialog.getByRole("button", { name: /Choose date & time/ }).click();
  await dialog
    .getByRole("button", { name: "Choose reminder date", exact: true })
    .click();
  const calendar = page.getByRole("dialog", {
    name: "Choose date",
    exact: true,
  });
  await expect(calendar).toBeVisible();
  await page.screenshot({ path: "../../.local/reminders-calendar-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  const calendarBounds = await calendar.boundingBox();
  expect(calendarBounds!.x).toBeGreaterThanOrEqual(0);
  expect(calendarBounds!.x + calendarBounds!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "../../.local/reminders-calendar-mobile.png" });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.keyboard.press("Escape");
  await expect(calendar).not.toBeVisible();
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole("button", { name: "Choose reminder date", exact: true })
    .click();
  await calendar.getByRole("button", { name: "Year", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "2027", exact: true }).click();
  await calendar.getByRole("button", { name: "Month", exact: true }).click();
  await page
    .getByRole("menuitemradio", { name: "November", exact: true })
    .click();
  await calendar
    .getByRole("button", { name: "Choose 2027-11-05", exact: true })
    .click();
  await dialog.getByRole("button", { name: "Hour", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "15", exact: true }).click();
  await dialog.getByRole("button", { name: "Minute", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "45", exact: true }).click();
  await dialog.getByRole("button", { name: "Repeat", exact: true }).click();
  await page
    .getByRole("menuitemradio", { name: "Every week", exact: true })
    .click();
  await dialog.getByRole("button", { name: "Save time", exact: true }).click();
  await expect(page.locator(".reminder-countdown")).toContainText("Every week");
  await expect(page.locator(".reminder-time")).toContainText("2027");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Notifications", exact: true })
    .click();
  await page.getByLabel("Default snooze (minutes)").fill("25");
  await page
    .getByRole("button", { name: "Save preferences", exact: true })
    .click();
  await expect(
    page.getByText("Notification settings saved", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Snooze 25m", exact: true }),
  ).toBeVisible();
  const alignment = await page.locator(".composer").evaluate((element) => {
    const button = element
      .querySelector(".send-button")!
      .getBoundingClientRect();
    const icon = element
      .querySelector(".send-button svg")!
      .getBoundingClientRect();
    const plus = element
      .querySelector(".attach-button svg")!
      .getBoundingClientRect();
    return {
      x: Math.abs(button.x + button.width / 2 - icon.x - icon.width / 2),
      y: Math.abs(button.y + button.height / 2 - icon.y - icon.height / 2),
      plus: Math.abs(button.y + button.height / 2 - plus.y - plus.height / 2),
    };
  });
  expect(alignment.x).toBeLessThan(1);
  expect(alignment.y).toBeLessThan(1);
  expect(alignment.plus).toBeLessThan(1);
  await page.screenshot({
    path: "../../.local/reminders-integrated-desktop.png",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".reminder-snooze")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "../../.local/reminders-integrated-mobile.png",
  });
  await page.setViewportSize({ width: 1440, height: 960 });
  const notes = await api(page, `/workspaces/${project.id}/channels`, "POST", {
    name: "notes",
    kind: "note",
  });
  await page.goto(`/w/${project.id}/c/${notes.id}`);
  const input = page.getByRole("textbox", {
    name: "Message notes",
    exact: true,
  });
  await input.fill("/remind 1h Call tomorrow");
  await input.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator(".note")).toHaveCount(1);
  await expect(page.locator(".note-main")).toContainText("Call tomorrow");
  await expect(page.locator(".note-main")).not.toContainText("/remind");
  await input.fill("An ordinary note");
  await input.press("Enter");
  await expect(page.locator(".note")).toHaveCount(2);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(errors).toEqual([]);
});
