import { expect, test, type Page } from "@playwright/test";

async function api(page: Page, path: string, method = "GET", body?: unknown) {
  return page.evaluate(
    async ({ path, method, body }) => {
      const csrf = document.cookie
        .split("; ")
        .find((value) => value.startsWith("noted_csrf="))
        ?.slice(11);
      const response = await fetch(`/api/v1${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrf ?? "",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!response.ok) throw new Error(await response.text());
      return response.status === 204 ? null : response.json();
    },
    { path, method, body },
  );
}

async function setup(page: Page, android = false) {
  await page.goto(android ? "/?client=android&nativePush=1" : "/");
  await page.getByLabel("Username", { exact: true }).fill("ilya");
  await page
    .getByLabel("Password", { exact: true })
    .fill("browser-test-password-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".app-shell")).toBeVisible();
  const workspace = await api(page, "/workspaces", "POST", {
    name: "Sidebar gestures",
  });
  const path = `/workspaces/${workspace.id}`;
  const first = await api(page, `${path}/categories`, "POST", {
    name: "First",
    position: 0,
  });
  const second = await api(page, `${path}/categories`, "POST", {
    name: "Second",
    position: 1,
  });
  const third = await api(page, `${path}/categories`, "POST", {
    name: "Third",
    position: 2,
  });
  const one = await api(page, `${path}/channels`, "POST", {
    name: "one",
    category_id: first.id,
    position: 0,
  });
  const two = await api(page, `${path}/channels`, "POST", {
    name: "two",
    category_id: first.id,
    position: 1,
  });
  const loose = await api(page, `${path}/channels`, "POST", { name: "loose" });
  await api(page, `/channels/${one.id}/messages`, "POST", {
    content: "A note that stays with its channel",
  });
  await page.goto(`/w/${workspace.id}/c/${one.id}`);
  await expect(
    page.getByRole("heading", { name: "one", exact: true }),
  ).toBeVisible();
  return { workspace, first, second, third, one, two, loose };
}

test("mouse dragging reorders categories and channels, moves groups, and survives reload", async ({
  page,
}) => {
  const items = await setup(page);
  const channel = (id: string) => page.locator(`[data-channel-id="${id}"]`);
  const category = (id: string) => page.locator(`[data-category-id="${id}"]`);
  const saved = () =>
    page.waitForResponse(
      (response) =>
        response.url().endsWith(`/workspaces/${items.workspace.id}/order`) &&
        response.request().method() === "PUT",
    );
  await expect(channel(items.two.id)).toHaveAttribute("draggable", "true");
  let response = saved();
  await channel(items.two.id).dragTo(channel(items.one.id), {
    targetPosition: { x: 40, y: 3 },
  });
  expect((await response).ok()).toBe(true);
  await expect(category(items.first.id).locator(".channel-link")).toHaveText([
    "two",
    "one",
  ]);

  response = saved();
  await category(items.third.id)
    .locator(".category-heading")
    .dragTo(category(items.first.id), { targetPosition: { x: 50, y: 3 } });
  expect((await response).ok()).toBe(true);
  await expect(page.locator(".category-toggle")).toHaveText([
    "Third",
    "First",
    "Second",
  ]);

  await category(items.second.id)
    .getByRole("button", { name: "Second", exact: true })
    .click();
  response = saved();
  await channel(items.two.id).dragTo(
    category(items.second.id).locator(".category-heading"),
  );
  expect((await response).ok()).toBe(true);
  await category(items.second.id)
    .getByRole("button", { name: "Second", exact: true })
    .click();
  await expect(category(items.second.id).locator(".channel-link")).toHaveText([
    "two",
  ]);

  response = saved();
  await channel(items.one.id).dragTo(channel(items.loose.id), {
    targetPosition: { x: 40, y: 3 },
  });
  expect((await response).ok()).toBe(true);
  await expect(page.locator(".ungrouped-channels .channel-link")).toHaveText([
    "one",
    "loose",
  ]);
  await page.reload();
  await expect(page.locator(".category-toggle")).toHaveText([
    "Third",
    "First",
    "Second",
  ]);
  await expect(page.locator(".ungrouped-channels .channel-link")).toHaveText([
    "one",
    "loose",
  ]);
  await expect(category(items.second.id).locator(".channel-link")).toHaveText([
    "two",
  ]);
  await expect(page.locator(".note .markdown")).toContainText(
    "A note that stays with its channel",
  );

  await page.route(`**/workspaces/${items.workspace.id}/order`, (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ detail: "Order could not be saved" }),
    }),
  );
  await channel(items.loose.id).dragTo(channel(items.one.id), {
    targetPosition: { x: 40, y: 3 },
  });
  await expect(
    page.getByText("Order could not be saved", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".ungrouped-channels .channel-link")).toHaveText([
    "one",
    "loose",
  ]);
});

test.describe("Android touch navigation", () => {
  test.use({
    viewport: { width: 412, height: 892 },
    hasTouch: true,
    isMobile: true,
  });

  test("swipes open and close navigation without enabling touch reorder or hijacking scroll and editors", async ({
    page,
  }) => {
    await setup(page, true);
    const touch = await page.context().newCDPSession(page);
    async function swipe(x: number, y: number, dx: number, dy = 0) {
      await touch.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x, y }],
      });
      for (let step = 1; step <= 8; step++)
        await touch.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x: x + (dx * step) / 8, y: y + (dy * step) / 8 }],
        });
      await touch.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
    }
    const shell = page.locator(".app-shell");
    await swipe(60, 200, 3, 100);
    await expect(shell).not.toHaveClass(/mobile-nav-open/);
    await swipe(60, 200, 30);
    await expect(shell).not.toHaveClass(/mobile-nav-open/);
    await swipe(60, 200, 150, 5);
    await expect(shell).toHaveClass(/mobile-nav-open/);
    await expect(
      page.locator(
        ".channel-row[draggable='true'], .category-heading[draggable='true']",
      ),
    ).toHaveCount(0);
    await expect(page.locator(".channel-sidebar")).toBeVisible();
    await expect(page.locator(".channel-sidebar")).toHaveCSS(
      "transform",
      "matrix(1, 0, 0, 1, 0, 0)",
    );
    await page.screenshot({
      path: "../../.local/screenshots/android-sidebar-swipe.png",
    });
    await swipe(220, 450, -150);
    await expect(shell).not.toHaveClass(/mobile-nav-open/);
    const editor = page.getByRole("textbox", { name: "Message one" });
    const bounds = await editor.boundingBox();
    if (!bounds) throw new Error("Composer is not visible");
    await swipe(60, bounds.y + bounds.height / 2, 120);
    await expect(shell).not.toHaveClass(/mobile-nav-open/);
    await swipe(60, 200, 150);
    await expect(shell).toHaveClass(/mobile-nav-open/);
    await page.goBack();
    await expect(shell).not.toHaveClass(/mobile-nav-open/);
  });
});
