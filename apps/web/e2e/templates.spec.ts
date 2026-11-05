import { expect, test, type Page } from "./fixtures";

async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill("ilya");
  await page
    .getByLabel("Password", { exact: true })
    .fill("browser-test-password-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".app-shell")).toBeVisible();
}

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

test("N01 manages exact Markdown and inserts it into an existing message draft", async ({
  page,
}) => {
  await login(page);
  const project = await api(page, "/workspaces", "POST", { name: "Templates" });
  const channel = await api(
    page,
    `/workspaces/${project.id}/channels`,
    "POST",
    { name: "journal-drafts" },
  );
  await page.goto(`/w/${project.id}/c/${channel.id}`);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await settings
    .getByRole("button", { name: "Note templates", exact: true })
    .click();
  await settings.getByRole("button", { name: "New", exact: true }).click();
  await settings
    .getByLabel("Template name", { exact: true })
    .fill("Daily journal");
  const content = "## Today\n\n\n  spaces stay  \n\n- [ ] One small thing\n";
  await settings.getByLabel("Template Markdown", { exact: true }).fill(content);
  await settings
    .getByRole("button", { name: "Save template", exact: true })
    .click();
  await expect(settings.locator(".template-list-row")).toContainText(
    "Daily journal",
  );
  await expect(
    settings.getByLabel("Template Markdown", { exact: true }),
  ).toHaveValue(content);
  await page.screenshot({ path: "../../.local/templates-note-manager.png" });
  await settings
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  const draft = page.getByLabel("Message journal-drafts", { exact: true });
  await draft.fill("beforeafter");
  await draft.evaluate((input: HTMLTextAreaElement) =>
    input.setSelectionRange(6, 6),
  );
  await page
    .getByRole("button", { name: "Note templates", exact: true })
    .click();
  await expect(
    page.locator(".note-template-picker .template-list-row"),
  ).toContainText("Daily journal");
  await page.screenshot({ path: "../../.local/templates-note-insertion.png" });
  await page
    .getByRole("button", { name: "Insert template", exact: true })
    .click();
  await expect(draft).toHaveValue(`before${content}after`);
  await expect(draft).toBeFocused();
  expect(
    await draft.evaluate((input: HTMLTextAreaElement) => input.selectionStart),
  ).toBe(6 + content.length);
  await page
    .getByRole("button", { name: "Note templates", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Manage templates", exact: true })
    .click();
  await expect(
    settings.getByRole("heading", { name: "Note templates", exact: true }),
  ).toBeVisible();
  await settings
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await settings
    .getByRole("button", { name: "Note templates", exact: true })
    .click();
  await expect(
    settings.getByLabel("Template Markdown", { exact: true }),
  ).toHaveValue(content);
});

test("D01 edits horizontal blocks, applies under the right date, and opens a phone sheet", async ({
  page,
}) => {
  await login(page);
  await api(page, "/time-tracking/activities", "POST", {
    name: "Deep work",
    icon: "Code2",
  });
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await settings
    .getByRole("button", { name: "Time tracking", exact: true })
    .click();
  const templates = settings.locator('[data-section="templates"]');
  await templates.getByRole("button", { name: "New", exact: true }).click();
  await templates
    .getByLabel("Template name", { exact: true })
    .fill("Focused morning");
  await templates.getByRole("button", { name: "Block", exact: true }).click();
  const card = page.getByRole("dialog", {
    name: "Edit template block",
    exact: true,
  });
  await card.getByLabel("Title", { exact: true }).fill("A little focus");
  await card.getByLabel("Start", { exact: true }).fill("9");
  await card.getByLabel("End", { exact: true }).fill("10:00");
  await card.getByRole("button", { name: "Add", exact: true }).click();
  await templates.getByRole("button", { name: "Save", exact: true }).click();
  await expect(templates.locator(".template-list-row")).toContainText(
    "Focused morning",
  );
  const track = templates.locator(".day-template-track");
  await track.scrollIntoViewIfNeeded();
  const bounds = (await track.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width * 0.35, bounds.y + 20);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.45, bounds.y + 20, {
    steps: 5,
  });
  await page.mouse.up();
  await card.getByRole("button", { name: "Add", exact: true }).click();
  const saved = page.waitForResponse(
    (response) =>
      response.url().includes("/templates/days/") &&
      response.request().method() === "PUT",
  );
  await templates.getByRole("button", { name: "Save", exact: true }).click();
  expect((await saved).status()).toBe(200);
  await expect(templates.locator(".template-list-row")).toContainText(
    "2 blocks",
  );
  await page.screenshot({ path: "../../.local/templates-day-manager.png" });
  await settings
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await page
    .locator(".sidebar-global-navigation")
    .getByRole("button", { name: "Calendar", exact: true })
    .click();
  const useButton = page.locator(".day-use-template").first();
  await useButton.scrollIntoViewIfNeeded();
  const destination = (await useButton.getAttribute("aria-label"))!.replace(
    "Use template on ",
    "",
  );
  await useButton.click();
  const [applied] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/apply"),
    ),
    page.getByRole("button", { name: "Use template", exact: true }).click(),
  ]);
  expect(applied.status()).toBe(200);
  const plans = await api(
    page,
    `/schedule?start=${destination}T00:00:00Z&end=${destination}T23:59:59Z`,
  );
  expect(plans.plans).toHaveLength(2);
  expect(plans.plans[0].date).toBe(destination);
  expect(plans.plans[0].frequency).toBe("none");
  expect(plans.plans.map((plan: { title: string }) => plan.title)).toContain(
    "A little focus",
  );
  await page.screenshot({ path: "../../.local/templates-calendar.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await useButton.scrollIntoViewIfNeeded();
  await useButton.click();
  await expect(
    page.getByRole("dialog", { name: "Use a day template", exact: true }),
  ).toHaveClass(/plan-sheet/);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "../../.local/templates-phone-sheet.png" });
});
