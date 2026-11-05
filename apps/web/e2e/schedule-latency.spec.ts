import { expect, test, type Page } from "./fixtures";

async function api(page: Page, path: string, body?: unknown, method = "POST") {
  return page.evaluate(
    async ({ path, body, method }) => {
      const csrf =
        document.cookie
          .split("; ")
          .find((item) => item.startsWith("noted_csrf="))
          ?.split("=")[1] ?? "";
      const response = await fetch(`/api/v1${path}`, {
        method,
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    },
    { path, body, method },
  );
}

async function calendar(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill("ilya");
  await page
    .getByLabel("Password", { exact: true })
    .fill("browser-test-password-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".app-shell")).toBeVisible();
  const activity = await api(page, "/time-tracking/activities", {
    name: "Reading",
  });
  await page.goto("/schedule");
  await expect(page.locator(".schedule-grid")).toBeVisible();
  return activity;
}

async function add(page: Page, title: string) {
  await page.getByRole("button", { name: "Add plan", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "New plan", exact: true });
  await editor.getByLabel("Title", { exact: true }).fill(title);
  await editor.getByRole("button", { name: "Add", exact: true }).click();
  await expect(editor).toBeHidden({ timeout: 1000 });
  return page
    .locator(".planned-block:not(.plan-draft)")
    .filter({ hasText: title })
    .first();
}

test("calendar saves locally while responses are held and queues edits of a new plan", async ({
  page,
}) => {
  await calendar(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let first = true;
  const creates: Record<string, unknown>[] = [];
  const revisions: number[] = [];
  await page.route("**/api/v1/schedule/plans", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    creates.push(route.request().postDataJSON());
    if (first) {
      first = false;
      await gate;
    }
    await route.continue();
  });
  await page.route("**/api/v1/schedule/plans/*", async (route) => {
    if (route.request().method() === "PUT")
      revisions.push(route.request().postDataJSON().revision);
    await route.continue();
  });
  try {
    const block = await add(page, "Slow first save");
    await expect(block).toBeVisible();
    await block.click();
    const editor = page.getByRole("dialog", { name: "Edit plan", exact: true });
    await editor
      .getByLabel("Title", { exact: true })
      .fill("Edited before confirmation");
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await expect(editor).toBeHidden({ timeout: 1000 });
    await expect(
      page
        .locator(".planned-block")
        .filter({ hasText: "Edited before confirmation" }),
    ).toBeVisible();
    const other = await add(page, "Independent save");
    await expect(other).toBeVisible();
    await expect.poll(() => creates.length).toBe(2);
    expect(revisions).toHaveLength(0);
    await page
      .locator(".sidebar-global-navigation")
      .getByRole("button", { name: "Home", exact: true })
      .click();
    await page
      .locator(".sidebar-global-navigation")
      .getByRole("button", { name: "Calendar", exact: true })
      .click();
    await expect(
      page
        .locator(".planned-block")
        .filter({ hasText: "Edited before confirmation" }),
    ).toBeVisible();
  } finally {
    release();
  }
  await expect.poll(() => revisions.length).toBe(1);
  await expect(page.locator(".schedule-sync-status")).toHaveCount(0);
  const saved = await api(
    page,
    `/schedule/plans/${creates[0].client_id}`,
    undefined,
    "GET",
  );
  expect(saved.title).toBe("Edited before confirmation");
  expect(saved.revision).toBe(2);
  expect(revisions[0]).toBe(1);
});

test("calendar rolls back a rejected background edit and keeps its draft for review", async ({
  page,
}) => {
  const activity = await calendar(page);
  const today = new Date().toISOString().slice(0, 10);
  const saved = await api(page, "/schedule/plans", {
    activity_id: activity.id,
    title: "Original plan",
    date: today,
    timezone: "UTC",
    start_minute: 600,
    end_minute: 660,
    frequency: "none",
    weekdays: [],
    repeat_until: null,
  });
  await page.reload();
  const block = page
    .locator(".planned-block")
    .filter({ hasText: "Original plan" })
    .first();
  await expect(block).toBeVisible();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**/api/v1/schedule/plans/${saved.id}`, async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    await gate;
    await route.fulfill({
      status: 409,
      json: { detail: "This plan changed on another device." },
    });
  });
  try {
    await block.click();
    const editor = page.getByRole("dialog", { name: "Edit plan", exact: true });
    await editor
      .getByLabel("Title", { exact: true })
      .fill("My unsaved changes");
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await expect(editor).toBeHidden({ timeout: 1000 });
    await expect(
      page.locator(".planned-block").filter({ hasText: "My unsaved changes" }),
    ).toBeVisible();
  } finally {
    release();
  }
  await expect(page.locator(".schedule-sync-failure")).toContainText(
    "This plan changed",
  );
  await expect(block).toBeVisible();
  await page.getByRole("button", { name: "Review", exact: true }).click();
  const recovery = page.getByRole("dialog", { name: "Edit plan", exact: true });
  await expect(recovery.getByLabel("Title", { exact: true })).toHaveValue(
    "My unsaved changes",
  );
  await page.unroute(`**/api/v1/schedule/plans/${saved.id}`);
  await recovery
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(page.locator(".schedule-sync-status")).toHaveCount(0);
  const result = await api(
    page,
    `/schedule/plans/${saved.id}`,
    undefined,
    "GET",
  );
  expect(result.title).toBe("My unsaved changes");
});
