import { expect, test } from "@playwright/test";

const gif = Buffer.from(
  "R0lGODlhGAAMAIEAAP8AAAAAAAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQACAAAACwAAAAAGAAMAAAIHgABCBxIsKDBgwgTKlzIsKHDhxAjSpxIsaLFiwwDAgAh+QQBEAABACwAAAAAGAAMAIEAAP8AAAAAAAAAAAAIHgABCBxIsKDBgwgTKlzIsKHDhxAjSpxIsaLFiwwDAgA7",
  "base64",
);

test("account appearance, sessions, search controls and workspace icon imports work together", async ({ page, browser }) => {
  test.setTimeout(90000);
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill("ilya");
  await page.getByLabel("Password", { exact: true }).fill("browser-test-password-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Open search", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Search notes", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Open search", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Search notes", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await expect(page.getByLabel("Workspace", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Sort search results", exact: true }).click();
  await page.getByRole("menuitem", { name: "Oldest first" }).click();
  await expect(page.getByRole("button", { name: "Sort search results", exact: true })).toContainText("Oldest");
  await page.screenshot({ path: "../../.local/screenshots/search-controls-desktop.png", fullPage: true });
  await page.getByRole("button", { name: "Close search", exact: true }).click();

  await page.getByRole("button", { name: "Create workspace", exact: true }).click();
  await page.getByRole("dialog").getByLabel("Name", { exact: true }).fill("Icon picker fixture");
  await page.getByRole("button", { name: "Books", exact: true }).click();
  await expect(page.getByRole("button", { name: "Books", exact: true })).toHaveAttribute("aria-pressed", "true");
  const fileChooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Import image or GIF", exact: true }).click();
  await (await fileChooser).setFiles({ name: "wide.gif", mimeType: "image/gif", buffer: gif });
  await expect(page.getByAltText("Workspace icon preview")).toBeVisible();
  await page.screenshot({ path: "../../.local/screenshots/workspace-icon-picker.png", fullPage: true });
  let failedUpload = false;
  await page.route("**/api/v1/workspaces/*/icon", async (route) => {
    if (!failedUpload && route.request().method() === "PUT") {
      failedUpload = true;
      await route.fulfill({ status: 503, json: { detail: "Temporary icon upload failure. Try again." } });
    } else await route.continue();
  });
  await page.getByRole("dialog").getByRole("button", { name: "Create workspace", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Temporary icon upload failure");
  await page.getByRole("dialog").getByRole("button", { name: "Create workspace", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const projects = await page.evaluate(async () => (await fetch("/api/v1/workspaces")).json());
  expect(projects.filter((project: { name: string }) => project.name === "Icon picker fixture")).toHaveLength(1);
  const project = projects.find((item: { name: string }) => item.name === "Icon picker fixture");
  const dimensions = await page.evaluate(async (url: string) => {
    const image = new Image();
    image.src = url;
    await image.decode();
    return [image.naturalWidth, image.naturalHeight];
  }, project.icon_url);
  expect(dimensions).toEqual([512, 512]);

  const channel = await page.evaluate(async (id: string) => {
    const csrf = document.cookie.split("; ").find((value) => value.startsWith("noted_csrf="))!.split("=")[1];
    const response = await fetch(`/api/v1/workspaces/${id}/channels`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: JSON.stringify({ name: "layout-preview" }),
    });
    if (!response.ok) throw new Error("Could not create layout fixture channel");
    return response.json();
  }, project.id);
  await page.goto(`/w/${project.id}/c/${channel.id}`);
  for (const content of ["First thought", "A quick follow-up", "One more note"]) {
    const composer = page.getByRole("textbox", { name: "Message layout-preview", exact: true });
    await composer.fill(content);
    await composer.press("Enter");
    await expect(composer).toHaveValue("");
  }
  await expect(page.locator(".notes-list.layout-minute .note")).toHaveCount(3);
  await expect(page.locator(".note-group-start")).toHaveCount(1);
  await expect(page.locator(".note-group-follow")).toHaveCount(2);

  for (const [label, layout] of [
    ["Connected thoughts", "connected"],
    ["Quiet timestamp gutter", "quiet"],
    ["Compact rows", "rows"],
    ["Minute markers", "minute"],
  ]) {
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const persisted = page.waitForResponse((response) => response.url().includes("/settings/appearance") && response.request().method() === "PUT" && response.ok());
    await page.getByText(label, { exact: true }).click();
    await persisted;
    await page.getByRole("button", { name: "Close dialog", exact: true }).click();
    await expect(page.locator(`.notes-list.layout-${layout} .note`)).toHaveCount(3);
    if (layout === "quiet") {
      await expect(page.locator(".note-group-follow .note-time").first()).toBeHidden();
      await page.locator(".note-group-follow .note").first().focus();
      await expect(page.locator(".note-group-follow .note-time").first()).toBeVisible();
    }
    await page.screenshot({ path: `../../.local/screenshots/message-layout-${layout}.png`, fullPage: true });
  }

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const saved = page.waitForResponse((response) => response.url().includes("/settings/appearance") && response.request().method() === "PUT" && response.ok());
  await page.getByText("Connected thoughts", { exact: true }).click();
  await saved;
  await expect(page.getByText("Saving appearance...", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: "../../.local/screenshots/message-layout-settings.png", fullPage: true });

  const remote = await browser.newContext({ userAgent: "Mozilla/5.0 (Linux; Android 15; NotedTestPhone) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36" });
  try {
    const phone = await remote.newPage();
    await phone.goto("http://localhost:5173");
    await phone.getByLabel("Username", { exact: true }).fill("ilya");
    await phone.getByLabel("Password", { exact: true }).fill("browser-test-password-only");
    await phone.getByRole("button", { name: "Sign in", exact: true }).click();
    await phone.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(phone.getByRole("radio", { name: "Connected thoughts", exact: true })).toBeChecked();
    const changed = phone.waitForResponse((response) => response.url().includes("/settings/appearance") && response.request().method() === "PUT" && response.ok());
    await phone.getByText("Quiet timestamp gutter", { exact: true }).click();
    await changed;
    await page.reload();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.getByRole("radio", { name: "Quiet timestamp gutter", exact: true })).toBeChecked();
    await page.getByRole("button", { name: "Sessions", exact: true }).click();
    await expect(page.getByText("This device", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Chrome on Android", exact: true })).toBeVisible();
    await page.screenshot({ path: "../../.local/screenshots/sessions-desktop.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: "../../.local/screenshots/sessions-mobile.png", fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("button", { name: "Sign out Chrome on Android", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Chrome on Android", exact: true })).toHaveCount(0);
    expect(await phone.evaluate(async () => (await fetch("/api/v1/auth/session")).status)).toBe(401);
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.getByRole("button", { name: "Appearance", exact: true }).click();
    const reset = page.waitForResponse((response) => response.url().includes("/settings/appearance") && response.request().method() === "PUT" && response.ok());
    await page.getByRole("button", { name: "Reset appearance", exact: true }).click();
    await reset;
  } finally {
    await remote.close();
  }
});
