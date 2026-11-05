import { expect, test, type Page } from "./fixtures";

async function choose(page: Page, label: string, option: string) {
  await page.getByRole("button", { name: label, exact: true }).click();
  await page.getByRole("menuitemradio", { name: option, exact: true }).click();
}

async function saved(page: Page, change: () => Promise<void>) {
  const response = page.waitForResponse(
    (response) =>
      response.url().endsWith("/time-tracking/preferences") &&
      response.request().method() === "PUT" &&
      response.ok(),
  );
  await change();
  return (await response).json();
}

test("workday patterns and one-off days persist and shade the calendar on desktop and mobile", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill("ilya");
  await page
    .getByLabel("Password", { exact: true })
    .fill("browser-test-password-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".app-shell")).toBeVisible();
  await page.goto("/schedule");
  await expect(page.locator(".schedule-grid")).toBeVisible();
  await page.locator(".schedule-hours-button").click();
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  const fields = settings.getByRole("region", {
    name: "Workdays and days off",
  });
  await fields.scrollIntoViewIfNeeded();
  await expect(
    fields.getByRole("button", { name: "Saturday off", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  let data = await saved(page, () =>
    fields.getByRole("button", { name: "Monday off", exact: true }).click(),
  );
  expect(data.preferences.work_schedule.off_weekdays).toEqual([0, 5, 6]);
  data = await saved(page, () =>
    choose(page, "Work schedule pattern", "Rotating cycle"),
  );
  const anchor = data.preferences.work_schedule.cycle_start;
  expect(anchor).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await expect(
    fields.getByRole("button", { name: "Consecutive workdays", exact: true }),
  ).toContainText("2 days");
  data = await saved(page, () =>
    fields.getByRole("button", { name: "Set day", exact: true }).click(),
  );
  expect(data.preferences.work_schedule.overrides[anchor]).toBe("off");
  await fields.screenshot({
    path: "../../.local/work-schedule-settings-desktop.png",
  });
  await settings
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  const row = page.locator(`.schedule-week-row[data-date="${anchor}"]`);
  await expect(row).toHaveClass(/is-day-off/);
  await expect(row.locator(".schedule-day-kind")).toHaveText("Day off");
  await row.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "../../.local/work-schedule-calendar-desktop.png",
  });
  await page.reload();
  await expect(
    page.locator(`.schedule-week-row[data-date="${anchor}"]`),
  ).toHaveClass(/is-day-off/);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".schedule-hours-button").click();
  await fields.scrollIntoViewIfNeeded();
  await fields.screenshot({
    path: "../../.local/work-schedule-settings-mobile.png",
  });
  await saved(page, () =>
    choose(page, "One-off day type", "Workday").then(() =>
      fields.getByRole("button", { name: "Set day", exact: true }).click(),
    ),
  );
  await settings
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await expect(row).not.toHaveClass(/is-day-off/);
  await expect(row.locator(".schedule-day-kind")).toHaveText("Workday");
  await row.locator(".schedule-day-label").click();
  await expect(page.locator(".schedule-activity-grid")).toBeVisible();
  await expect(
    page.locator(
      '.schedule-day-strip [aria-pressed="true"] .schedule-day-kind',
    ),
  ).toHaveText("Workday");
  await page.screenshot({
    path: "../../.local/work-schedule-calendar-mobile.png",
  });
  await page.locator(".schedule-hours-button").click();
  await fields.scrollIntoViewIfNeeded();
  data = await saved(page, () =>
    fields
      .getByRole("button", { name: `Reset ${anchor} to pattern`, exact: true })
      .click(),
  );
  expect(data.preferences.work_schedule.overrides).toEqual({});
  expect(data.preferences.work_schedule.mode).toBe("cycle");
  const closingSave = page.waitForResponse(
    (response) =>
      response.url().endsWith("/time-tracking/preferences") &&
      response.request().method() === "PUT" &&
      response.ok(),
  );
  await choose(page, "Consecutive days off", "3 days");
  await settings
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  expect(
    (await (await closingSave).json()).preferences.work_schedule.off_days,
  ).toBe(3);
  await page.reload();
  await page.locator(".schedule-hours-button").click();
  await fields.scrollIntoViewIfNeeded();
  await expect(
    fields.getByRole("button", { name: "Consecutive days off", exact: true }),
  ).toContainText("3 days");
  expect(errors).toEqual([]);
});
