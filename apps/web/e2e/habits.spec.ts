import { expect, test, type Page } from "./fixtures";

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill("ilya");
  await page
    .getByLabel("Password", { exact: true })
    .fill("browser-test-password-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".app-shell")).toBeVisible();
}

test("habits use approved list, editable progress and the real reminder timeline and calendar", async ({
  page,
}) => {
  await signIn(page);
  await page
    .locator(".sidebar-global-navigation")
    .getByRole("button", { name: "Habits", exact: true })
    .click();
  await page.getByRole("button", { name: "Add habit", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New habit", exact: true });
  await dialog.getByLabel("Name", { exact: true }).fill("Drink water");
  await dialog.getByRole("button", { name: "Amount", exact: true }).click();
  await dialog.getByLabel("Daily target", { exact: true }).fill("8");
  await dialog.getByLabel("Unit", { exact: true }).fill("glasses");
  await expect(
    dialog.getByRole("switch", { name: "Habit reminders" }),
  ).not.toBeChecked();
  await dialog.getByRole("switch", { name: "Habit reminders" }).check();
  await expect(
    dialog.getByRole("slider", { name: "Reminder time" }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Other date…", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Choose reminder date", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Choose date", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await dialog
    .getByRole("button", { name: "Create habit", exact: true })
    .click();
  const row = page.locator(".habit-row").filter({ hasText: "Drink water" });
  await expect(row).toBeVisible();
  await row.locator(".habit-count span").click();
  await expect(row.locator(".habit-count")).toContainText("1");
  await row.getByRole("checkbox", { name: "Drink water", exact: true }).check();
  await expect(row.locator(".habit-count strong")).toHaveText("8");
  await row
    .getByRole("checkbox", { name: "Drink water", exact: true })
    .uncheck();
  await expect(row.locator(".habit-count strong")).toHaveText("0");
  await expect(page.locator(".habits-heading").getByRole("button")).toHaveCount(
    0,
  );
  await page.screenshot({ path: "../../.local/habits-app-desktop.png" });
});

test("shared assistant retains draft across Home Calendar Habits and applies reviewed habit edits", async ({
  page,
}) => {
  await page.route("**/api/v1/ai/status", (route) =>
    route.fulfill({ json: { connected: true } }),
  );
  let requested = false;
  await page.route("**/api/v1/ai/assistant", async (route) => {
    requested = true;
    const body = route.request().postDataJSON();
    await route.fulfill({
      contentType: "application/x-ndjson",
      body:
        JSON.stringify({
          type: "done",
          output: {
            explanation: "Add a daily reading habit, with reminders off.",
            habits: [
              {
                id: null,
                revision: null,
                fields: {
                  name: "Read",
                  kind: "time",
                  goal: 20,
                  unit: "min",
                  period: "Evening",
                  weekdays: [0, 1, 2, 3, 4, 5, 6],
                  activity_id: null,
                  timezone: body.timezone,
                  starts_on: body.start,
                  reminder_minute: null,
                  reminder_start: null,
                },
              },
            ],
            plans: [],
          },
        }) + "\n",
    });
  });
  await signIn(page);
  await page.getByRole("button", { name: "Ask AI", exact: true }).click();
  const panel = page.getByRole("complementary", {
    name: "AI assistant",
    exact: true,
  });
  await panel
    .getByRole("textbox", { name: "Message assistant" })
    .fill("Add a reading habit");
  for (const name of ["Calendar", "Habits", "Home"]) {
    await page
      .locator(".sidebar-global-navigation")
      .getByRole("button", { name, exact: true })
      .click();
    await expect(
      panel.getByRole("textbox", { name: "Message assistant" }),
    ).toHaveValue("Add a reading habit");
  }
  await panel
    .getByRole("textbox", { name: "Message assistant" })
    .press("Enter");
  await expect(panel.getByText("New habit", { exact: true })).toBeVisible();
  expect(requested).toBe(true);
  await page
    .locator(".sidebar-global-navigation")
    .getByRole("button", { name: "Habits", exact: true })
    .click();
  await expect(page.locator(".habit-row")).toHaveCount(0);
  await panel
    .getByRole("button", { name: "Apply changes", exact: true })
    .click();
  await expect(
    page.locator(".habit-row").filter({ hasText: "Read" }),
  ).toBeVisible();
  await expect(panel.getByText("Applied", { exact: true })).toBeVisible();
  await page.screenshot({ path: "../../.local/habits-app-assistant.png" });
});

test.describe("phone habits", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("habit editor and actual reminder picker fit on phone", async ({
    page,
  }) => {
    await signIn(page);
    await page.goto("/habits");
    await page.getByRole("button", { name: "Add habit", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "New habit", exact: true });
    await dialog.getByRole("switch", { name: "Habit reminders" }).check();
    await expect(
      dialog.getByRole("slider", { name: "Reminder time" }),
    ).toBeVisible();
    await page.screenshot({
      path: "../../.local/habits-app-mobile-picker.png",
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
  });
});
