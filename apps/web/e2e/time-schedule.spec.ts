import { expect, test, type Page } from "@playwright/test";

async function api(page: Page, path: string, method = "GET", body?: unknown) {
  return page.evaluate(
    async ({ path, method, body }) => {
      const csrf =
        document.cookie
          .split("; ")
          .find((value) => value.startsWith("noted_csrf="))
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

async function choose(page: Page, label: string, option: string) {
  await page.getByRole("button", { name: label, exact: true }).click();
  await page.getByRole("menuitemradio", { name: option, exact: true }).click();
}

test("global tracker and horizontal schedule persist plans, preferences, and reminder flags", async ({
  page,
}) => {
  const calendarTime = new Date(Date.now() + 24 * 60 * 60 * 1000);
  calendarTime.setUTCHours(10, 0, 0, 0);
  await page.clock.setFixedTime(calendarTime);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill("ilya");
  await page
    .getByLabel("Password", { exact: true })
    .fill("browser-test-password-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".app-shell")).toBeVisible();
  const project = await api(page, "/workspaces", "POST", {
    name: "Time study",
  });
  const channel = await api(
    page,
    `/workspaces/${project.id}/channels`,
    "POST",
    { name: "reminders", kind: "reminder" },
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
  await settings
    .getByLabel("Activity name", { exact: true })
    .fill("Building Noted");
  await settings
    .getByRole("button", { name: "Code2 icon", exact: true })
    .click();
  await settings
    .getByRole("button", { name: "Add activity", exact: true })
    .click();
  await expect(
    settings
      .locator(".tracking-activity-row")
      .filter({ hasText: "Building Noted" }),
  ).toBeVisible();
  await settings.getByRole("button", { name: "Schedule", exact: true }).click();
  await choose(page, "Schedule start", "06:00");
  await choose(page, "Schedule end", "24:00 · midnight");
  await choose(page, "Schedule timezone", "Europe/Moscow");
  await settings
    .getByRole("button", { name: "Save schedule settings", exact: true })
    .click();
  await expect(
    page.getByText("Schedule settings saved", { exact: true }),
  ).toBeVisible();
  await settings
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Choose current activity", exact: true })
    .click();
  const picker = page.getByRole("region", {
    name: "Choose activity",
    exact: true,
  });
  await expect(picker).toBeVisible();
  await expect(page.locator(".activity-picker")).toHaveCount(0);
  await picker
    .getByRole("button", { name: "Building Noted", exact: true })
    .click();
  await expect(page.locator(".tracker-trigger")).toContainText(
    "Building Noted",
  );
  await page.getByRole("button", { name: "Pause timer", exact: true }).click();
  await page.getByRole("button", { name: "Resume timer", exact: true }).click();
  await page
    .locator(".workspace-rail")
    .getByRole("button", { name: "Home", exact: true })
    .click();
  await page
    .locator(".sidebar-global-navigation")
    .getByRole("button", { name: "Calendar", exact: true })
    .click();
  await expect(page).toHaveURL(/\/schedule$/);
  await expect(page.locator(".schedule-time-axis")).toContainText("06:00");
  await expect(page.locator(".schedule-time-axis")).toContainText("24:00");
  await page.getByRole("button", { name: "Add plan", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "New plan", exact: true });
  await editor.getByLabel("Title", { exact: true }).fill("Read and build");
  await choose(page, "Repeat", "Every 2 weeks");
  const selected = editor.locator('.schedule-weekdays [aria-pressed="true"]');
  for (const button of await selected.all()) await button.click();
  await editor.getByRole("button", { name: "Mon", exact: true }).click();
  await editor.getByRole("button", { name: "Fri", exact: true }).click();
  await editor.getByRole("button", { name: "Add plan", exact: true }).click();
  await expect(editor).toBeHidden();
  await page.reload();
  await expect(page.locator(".schedule-time-axis")).toContainText("06:00");
  await expect(page.locator(".tracker-trigger")).toContainText(
    "Building Noted",
  );
  await page.getByRole("button", { name: "Day", exact: true }).click();
  await expect(
    page
      .locator(".schedule-activity-row")
      .filter({ hasText: "Building Noted" }),
  ).toBeVisible();
  const due = new Date(calendarTime.getTime() + 30 * 60000);
  const message = await api(page, `/channels/${channel.id}/messages`, "POST", {
    content: "Read the next chapter",
    reminder: { due_at: due.toISOString(), timezone: "Europe/Moscow" },
  });
  await page.reload();
  await expect(
    page.getByRole("button", {
      name: /Reminder: Time study, reminders, Read the next chapter/,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Day", exact: true }).click();
  await expect(page.locator(".schedule-day-reminders")).toBeVisible();
  await page.screenshot({ path: "../../.local/schedule-app-day.png" });
  await page
    .getByRole("button", {
      name: /Reminder: Time study, reminders, Read the next chapter/,
    })
    .click();
  await expect(page).toHaveURL(new RegExp(`note=${message.id}`));
  await expect(
    page.getByRole("article").filter({ hasText: "Read the next chapter" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Stop timer", exact: true }).click();
  await page
    .locator(".workspace-rail")
    .getByRole("button", { name: "Home", exact: true })
    .click();
  await page
    .locator(".sidebar-global-navigation")
    .getByRole("button", { name: "Calendar", exact: true })
    .click();
  await page.screenshot({ path: "../../.local/schedule-app-week.png" });
  const line = page.locator("[data-draw]").first();
  await line.scrollIntoViewIfNeeded();
  const box = (await line.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.7, box.y + 25);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.8, box.y + 25, { steps: 10 });
  await page.mouse.up();
  await expect(
    page.getByRole("dialog", { name: "New plan", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Title", { exact: true }).fill("Drawn plan");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Add plan", exact: true })
    .click();
  await expect(
    page.locator(".planned-block").filter({ hasText: "Drawn plan" }),
  ).toBeVisible();
  const drawn = page
    .locator(".planned-block")
    .filter({ hasText: "Drawn plan" });
  const originalStart = Number(await drawn.getAttribute("data-start"));
  const originalEnd = Number(await drawn.getAttribute("data-end"));
  const planBox = (await drawn.boundingBox())!;
  const timeline = (await line.boundingBox())!;
  await page.mouse.move(planBox.x + 15, planBox.y + 23);
  await page.mouse.down();
  await page.mouse.move(planBox.x + 15 + timeline.width / 18, planBox.y + 23, {
    steps: 8,
  });
  await page.mouse.up();
  await expect(drawn).toHaveAttribute("data-start", String(originalStart + 60));
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(drawn).toHaveAttribute("data-start", String(originalStart));
  const resize = (await drawn.boundingBox())!;
  await page.mouse.move(resize.x + resize.width - 3, resize.y + 22);
  await page.mouse.down();
  await page.mouse.move(
    resize.x + resize.width - 3 + timeline.width / 72,
    resize.y + 22,
    { steps: 8 },
  );
  await page.mouse.up();
  await expect(drawn).toHaveAttribute("data-end", String(originalEnd + 15));
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "Open navigation", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "../../.local/schedule-app-mobile.png" });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
