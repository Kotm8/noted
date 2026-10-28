import { expect, test } from "@playwright/test";

test("the owner can organize, write, edit, and delete persistent notes", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByLabel("Installation secret")).toHaveCount(0);
  await page.getByLabel("Username", { exact: true }).fill("ilya");
  await page.getByLabel("Password", { exact: true }).fill("browser-test-password-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  await page.getByRole("button", { name: "Create workspace", exact: true }).click();
  await page.getByRole("dialog").getByLabel("Name", { exact: true }).fill("Programming");
  await page.getByRole("dialog").getByRole("button", { name: "Star", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create workspace", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.locator(".workspace-title").click();
  await page.getByRole("menuitem", { name: "Create category" }).click();
  await page.getByRole("dialog").getByLabel("Name", { exact: true }).fill("Backend");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create category", exact: true })
    .click();

  await page.getByRole("button", { name: "Add channel to Backend" }).click();
  await page.getByRole("dialog").getByLabel("Name", { exact: true }).fill("python");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create channel", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "python", exact: true })).toBeVisible();

  const composer = page.getByRole("textbox", { name: "Message python" });
  const emptyComposer = await composer.boundingBox();
  expect(emptyComposer?.height).toBeGreaterThanOrEqual(38);
  expect(emptyComposer?.height).toBeLessThanOrEqual(50);
  await composer.fill(
    "**Keep small thoughts.**\n\n```python\nprint('Привет, мир')\n```\n\n- An idea\n- A useful snippet",
  );
  const expandedComposer = await composer.boundingBox();
  expect(expandedComposer!.height).toBeGreaterThan(emptyComposer!.height);
  await composer.press("Control+Enter");
  await expect(page.locator(".note")).toHaveCount(1);
  await expect(
    page.locator(".note strong").filter({ hasText: "Keep small thoughts." }),
  ).toBeVisible();
  await expect(page.locator("code.language-python")).toBeVisible();

  await composer.fill("Line one");
  await composer.press("Shift+Enter");
  await composer.pressSequentially("Line two");
  await composer.press("Enter");
  await expect(page.locator(".note")).toHaveCount(2);
  await expect(page.locator(".note-time")).toHaveCount(2);
  await expect(page.locator(".note-avatar, .note-meta")).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".note")).toHaveCount(2);

  await composer.press("ArrowUp");
  await page.getByRole("textbox", { name: "Edit note", exact: true }).fill("Updated second note");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Updated second note", { exact: true })).toBeVisible();

  await page.locator(".workspace-title").click();
  await page.getByRole("menuitem", { name: "Create channel", exact: true }).click();
  await page.getByRole("dialog").getByLabel("Name", { exact: true }).fill("ideas");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create channel", exact: true })
    .click();
  await page.getByRole("textbox", { name: "Message ideas" }).fill("A note in another channel");
  await page.getByRole("textbox", { name: "Message ideas" }).press("Enter");
  await expect(page.locator(".note")).toHaveCount(1);

  await page.getByRole("button", { name: "python", exact: true }).click();
  await expect(page.locator(".note")).toHaveCount(2);
  await page.keyboard.press("Control+k");
  await page.getByRole("textbox", { name: "Search notes", exact: true }).fill("another channel");
  await expect(page.locator(".search-result")).toHaveCount(1);
  await page.locator(".search-result").click();
  await expect(page.getByText("A note in another channel", { exact: true })).toBeVisible();
  await expect(page.locator('.note[data-highlighted="true"]')).toHaveCount(1);
  await page.getByRole("button", { name: "Close search" }).click();
  await page.getByRole("button", { name: "python", exact: true }).click();

  await page.locator(".note").last().hover();
  await page.locator(".note").last().getByRole("button", { name: "Note options" }).click();
  await page.getByRole("menuitem", { name: "Delete note" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete note", exact: true }).click();
  await expect(page.locator(".note")).toHaveCount(1);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("button", { name: "python", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Message python" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );

  await page.setViewportSize({ width: 1440, height: 960 });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Warm", exact: true }).click();
  await page.getByRole("slider", { name: "Text size", exact: true }).fill("17");
  await page.getByRole("slider", { name: "Interface zoom", exact: true }).fill("110");
  await expect(page.getByText("Saving appearance...", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.reload();
  await expect.poll(() => page.evaluate(() => document.documentElement.style.zoom)).toBe("1.1");
  expect(await page.evaluate(() => document.documentElement.style.zoom)).toBe("1.1");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("button", { name: "Warm", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "Reset appearance" }).click();
  await page.getByRole("button", { name: "Server", exact: true }).click();
  await expect(page.getByText("Private, owner only", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Welcome back." })).toBeVisible();
  await page.getByLabel("Username", { exact: true }).fill("ilya");
  await page.getByLabel("Password", { exact: true }).fill("browser-test-password-only");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible();
  await page.locator(".home-project-navigation").getByRole("button", { name: "Programming", exact: true }).click();
  await expect(page.getByRole("heading", { name: "python", exact: true })).toBeVisible();
  await expect(page.locator(".note")).toHaveCount(1);

  await expect(page.getByLabel("Attach files", { exact: true })).not.toBeVisible();
  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Add files", exact: true }).click();
  await (
    await fileChooserPromise
  ).setFiles({
    name: "reference.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("A saved reference"),
  });
  await expect(page.getByText("reference.txt", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Send note", exact: true }).click();
  await expect(page.locator(".file-attachment")).toHaveCount(1);
  const downloadPromise = page.waitForEvent("download");
  await page.locator(".file-attachment").click();
  expect((await downloadPromise).suggestedFilename()).toBe("reference.txt");

  await page.locator(".workspace-title").click();
  await page.getByRole("menuitem", { name: "Edit workspace", exact: true }).click();
  await page.getByLabel("Workspace image file", { exact: true }).setInputFiles({
    name: "icon.gif",
    mimeType: "image/gif",
    buffer: Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64"),
  });
  await expect(page.locator(".workspace-image-preview img")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Edit workspace", exact: true }).click();
  await expect(page.locator(".workspace-button img")).toHaveCount(1);

  const examples = [
    "Keeping Python notes and useful references in this channel.",
    "### Timezone-aware dates\nUse UTC for stored timestamps. Convert to the local timezone when displaying them.",
    "https://docs.python.org/3/library/datetime.html",
    "> Keep I/O at the edges, where it is easier to test.",
    "For tomorrow:\n- Review the error handling\n- Write the next migration\n- Back up the database",
    "```sql\nSELECT content, created_at\nFROM messages\nORDER BY created_at DESC\nLIMIT 20;\n```",
    "Сохранять мысли сразу, пока не забыл.",
  ];

  for (const [index, content] of examples.entries()) {
    await composer.fill(content);
    await composer.press("Control+Enter");
    await expect(page.locator(".note")).toHaveCount(index + 3);
  }

  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
  await page.screenshot({ path: "../../.local/screenshots/notes-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("textbox", { name: "Message python" })).toBeVisible();
  await expect(
    page.getByText("Сохранять мысли сразу, пока не забыл.", { exact: true }),
  ).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: "../../.local/screenshots/notes-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "Open search", exact: true }).click();
  await page.getByRole("textbox", { name: "Search notes" }).fill("timezone");
  await expect(page.locator(".search-result")).toHaveCount(1);
  await page.screenshot({ path: "../../.local/screenshots/search-mobile.png", fullPage: true });
  await page.locator(".search-result").click();
  await expect(page.locator('.note[data-highlighted="true"]')).toBeInViewport();
  await page.getByRole("button", { name: "Back to latest" }).click();
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.getByRole("button", { name: "Open search", exact: true }).click();
  await page.getByRole("textbox", { name: "Search notes", exact: true }).fill("notes");
  await expect(page.locator(".search-result")).toHaveCount(1);
  await page.screenshot({ path: "../../.local/screenshots/search-desktop.png", fullPage: true });
  await page.getByRole("button", { name: "Close search" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.screenshot({ path: "../../.local/screenshots/settings-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "../../.local/screenshots/settings-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.setViewportSize({ width: 1440, height: 960 });

  const channelId = page.url().split("/c/")[1];
  await page.evaluate(async (id) => {
    const csrf = document.cookie
      .split("; ")
      .find((cookie) => cookie.startsWith("noted_csrf="))!
      .split("=")[1];
    for (let index = 0; index < 52; index++) {
      const response = await fetch(`/api/v1/channels/${id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({ content: `Archive pagination ${index}` }),
      });
      if (!response.ok) throw new Error(`Could not create pagination fixture: ${response.status}`);
    }
  }, channelId);
  await page.reload();
  await expect(page.locator(".note")).toHaveCount(50);
  await page.getByRole("button", { name: "Open search", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Search notes", exact: true })
    .fill("Keep small thoughts");
  await expect(page.locator(".search-result")).toHaveCount(1);
  await page.locator(".search-result").click();
  await expect(page.locator('.note[data-highlighted="true"]')).toBeInViewport();
  await page.getByRole("button", { name: "Later notes", exact: true }).click();
  await expect(page.locator(".note")).toHaveCount(51);
  await page.getByRole("button", { name: "Back to latest", exact: true }).click();
  await expect(page.locator(".note")).toHaveCount(50);
  await expect(page.getByText("Archive pagination 51", { exact: true })).toBeInViewport();
  await page.locator(".search-result").click();
  await composer.fill("A new thought from an old search result");
  await composer.press("Enter");
  await expect(composer).toHaveValue("");
  await expect(
    page.getByText("A new thought from an old search result", { exact: true }),
  ).toBeInViewport();
  await page.reload();
  await expect(composer).toHaveValue("");
});
