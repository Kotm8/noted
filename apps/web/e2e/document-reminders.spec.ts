import { expect, test, type Page } from "./fixtures";

async function api(page: Page, path: string, method = "GET", body?: object) {
  return page.evaluate(
    async ({ path, method, body }) => {
      const csrf =
        document.cookie
          .split("; ")
          .find((item) => item.startsWith("noted_csrf="))
          ?.split("=")[1] ?? "";
      const response = await fetch(`/api/v1${path}`, {
        method,
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    },
    { path, method, body },
  );
}

test("Notes documents schedule named reminders and reopen their linked content", async ({
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
  await expect(page.locator(".app-shell")).toBeVisible();
  const project = await api(page, "/workspaces", "POST", { name: "Personal" });
  const channel = await api(
    page,
    `/workspaces/${project.id}/channels`,
    "POST",
    { name: "My notes", kind: "document" },
  );
  const path = `/w/${project.id}/c/${channel.id}`;
  await page.goto(path);
  const input = page.getByRole("textbox", {
    name: "Note contents",
    exact: true,
  });
  const content =
    "# Things to do\n\nKeep these notes.\n\n/remind Call the dentist";
  await input.fill(content);
  await input.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Remind me", exact: true });
  await expect(dialog.locator(".reminder-context")).toHaveText(
    "Call the dentist",
  );
  expect(
    await api(page, `/channels/${channel.id}/document/reminders`),
  ).toHaveLength(0);
  await page.keyboard.press("Escape");
  await expect(input).toHaveValue(content);
  await input.press("Enter");
  await dialog.getByRole("button", { name: "In 3 hours", exact: true }).click();
  await dialog
    .getByRole("button", { name: "Set reminder", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  const row = page.locator(".document-reminder");
  await expect(row).toContainText("Call the dentist");
  await expect(input).not.toHaveValue(/\/remind/);
  await expect(input).toHaveValue(/Keep these notes/);
  await expect(
    page.getByRole("status").filter({ hasText: "Saved" }),
  ).toBeVisible();
  const reminders = await api(
    page,
    `/channels/${channel.id}/document/reminders`,
  );
  expect(reminders).toHaveLength(1);
  const reminder = reminders[0];
  await page.getByRole("button", { name: "Preview note", exact: true }).click();
  await page
    .getByRole("button", { name: "Call the dentist", exact: true })
    .click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await page.goto(`${path}?documentReminder=${reminder.id}`);
  await expect(page.locator(".document-reminder.is-target")).toContainText(
    "Call the dentist",
  );
  await row
    .getByRole("checkbox", { name: "Complete Call the dentist", exact: true })
    .check();
  await expect(row).toHaveClass(/is-done/);
  const inlineReminder = page.locator(".document-reminder-link");
  await expect(inlineReminder).toHaveClass(/is-done/);
  await expect(inlineReminder).toHaveCSS(
    "text-decoration-line",
    "line-through",
  );
  const box = row.getByRole("checkbox");
  const size = await box.boundingBox();
  expect(size?.width).toBeLessThanOrEqual(22);
  expect(size?.height).toBeLessThanOrEqual(22);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(
    await row.evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  await page.screenshot({ path: "../../.local/document-reminders-phone.png" });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.screenshot({
    path: "../../.local/document-reminders-desktop.png",
  });
  await box.uncheck();
  await expect(row).not.toHaveClass(/is-done/);
  await expect(inlineReminder).not.toHaveClass(/is-done/);
  expect(errors).toEqual([]);
});
