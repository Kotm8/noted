import { clientVersion, expect, test, type Page } from "./fixtures";

async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill("ilya");
  await page
    .getByLabel("Password", { exact: true })
    .fill("browser-test-password-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".app-shell")).toBeVisible();
}

test("desktop settings profiles persist and preserve the current channel draft", async ({
  page,
  context,
}) => {
  await login(page);
  await page.evaluate(async () => {
    const csrf = document.cookie
      .split("; ")
      .find((v) => v.startsWith("noted_csrf="))!
      .slice(11);
    const post = async (path: string, body: unknown) =>
      (
        await fetch(`/api/v1${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
          body: JSON.stringify(body),
        })
      ).json();
    const workspace = await post("/workspaces", { name: "Settings check" });
    const channel = await post(`/workspaces/${workspace.id}/channels`, {
      name: "thoughts",
    });
    location.href = `/w/${workspace.id}/c/${channel.id}`;
  });
  const draft = page.getByLabel("Message thoughts", { exact: true });
  await draft.fill("Keep this unsent thought");
  const channelUrl = page.url();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/appearance$/);
  await expect(page.locator(".settings-destination")).toBeVisible();
  await expect(page.locator(".channel-sidebar")).toBeHidden();
  await expect(page.locator(".settings-sidebar .time-tracker")).toHaveCount(0);
  await page.evaluate(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, options) => {
      const response = await originalFetch(input, options);
      if (
        response.url.endsWith("/api/v1/settings/appearance") &&
        (!options?.method || options.method === "GET")
      )
        await new Promise((resolve) => setTimeout(resolve, 200));
      return response;
    };
  });
  await page.getByRole("button", { name: "Comic", exact: true }).click();
  await page.getByRole("button", { name: "Light", exact: true }).click();
  await page.getByLabel("Background color", { exact: true }).fill("#f1e3c1");
  await page.getByRole("button", { name: "Stars", exact: true }).click();
  await page.getByRole("button", { name: "Comic", exact: true }).click();
  await expect(
    page.getByLabel("Background color", { exact: true }),
  ).toHaveValue("#f1e3c1");
  await page
    .getByLabel("Message layout", { exact: true })
    .selectOption("connected");
  await expect(page.locator(".appearance-sample-body")).toHaveAttribute(
    "data-layout",
    "connected",
  );
  await page
    .getByLabel("Grouping interval", { exact: true })
    .selectOption("10");
  await expect(page.locator(".appearance-message-group")).toHaveCount(1);
  await page.getByRole("button", { name: "Snow", exact: true }).click();
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-background-profile",
    "snow",
  );
  await expect(page.locator(".appearance-save-status")).toHaveText(
    "Saved to your account",
  );
  await page.screenshot({ path: "../../.local/settings-implemented-snow.png" });
  const other = await context.newPage();
  await other.goto("/settings/appearance");
  await expect(
    other.getByRole("button", { name: "Snow", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await other.getByRole("button", { name: "Comic", exact: true }).click();
  await other.getByRole("button", { name: "Light", exact: true }).click();
  await expect(
    other.getByLabel("Background color", { exact: true }),
  ).toHaveValue("#f1e3c1");
  await other.close();
  await page
    .getByRole("button", { name: "Close settings", exact: true })
    .click();
  await expect(page).toHaveURL(channelUrl);
  await expect(draft).toHaveValue("Keep this unsent thought");
});

test("settings protects unsaved templates and phone keeps its dialog", async ({
  page,
}) => {
  await login(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Note templates", exact: true })
    .click();
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page
    .getByLabel("Template name", { exact: true })
    .fill("Unsaved journal");
  await page
    .getByLabel("Template Markdown", { exact: true })
    .fill("## Today\n\n- [ ] Read");
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  const confirmation = page.getByRole("dialog", {
    name: "Discard unsaved template changes?",
  });
  await expect(confirmation).toBeVisible();
  await confirmation
    .getByRole("button", { name: "Keep editing", exact: true })
    .click();
  await expect(page.getByLabel("Template name", { exact: true })).toHaveValue(
    "Unsaved journal",
  );
  await page
    .getByRole("button", { name: "Save template", exact: true })
    .click();
  await expect(page.locator(".template-list-row")).toContainText(
    "Unsaved journal",
  );
  await page
    .getByRole("button", { name: "Close settings", exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Open navigation", exact: true })
    .click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Settings", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".settings-destination")).toHaveCount(0);
});

test("channel library opens source messages and preserves the composer", async ({
  page,
}) => {
  await login(page);
  const data = await page.evaluate(async () => {
    const csrf = document.cookie
      .split("; ")
      .find((v) => v.startsWith("noted_csrf="))!
      .slice(11);
    const post = async (path: string, body: unknown) =>
      (
        await fetch(`/api/v1${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
          body: JSON.stringify(body),
        })
      ).json();
    const project = await post("/workspaces", { name: "Library check" });
    const channel = await post(`/workspaces/${project.id}/channels`, {
      name: "links",
    });
    const root = await post(`/channels/${channel.id}/messages`, {
      content: "Read https://example.com/guide",
    });
    const reply = await post(`/messages/${root.id}/thread`, {
      content: "Reply https://example.com/reply",
    });
    return { project, channel, root, reply };
  });
  await page.goto(`/w/${data.project.id}/c/${data.channel.id}`);
  await page.getByLabel("Message links", { exact: true }).fill("Keep my draft");
  await page.getByRole("tab", { name: "Files & links", exact: true }).click();
  await expect(
    page
      .locator(".library-link")
      .filter({ hasText: "https://example.com/guide" }),
  ).toHaveAttribute("href", "https://example.com/guide");
  await page.getByRole("button", { name: "Open message", exact: true }).click();
  await expect(page.locator(`#note-${data.root.id}`)).toBeVisible();
  await expect(page.getByLabel("Message links", { exact: true })).toHaveValue(
    "Keep my draft",
  );
  await page.getByRole("tab", { name: "Files & links", exact: true }).click();
  await page.getByRole("button", { name: "Open reply", exact: true }).click();
  await expect(
    page.locator(`.writing-sidebar #note-${data.reply.id}`),
  ).toBeVisible();
  await expect(page.getByLabel("Message links", { exact: true })).toHaveValue(
    "Keep my draft",
  );
});

test("theme imports validate before saving and reading controls persist", async ({
  page,
}) => {
  await login(page);
  await page.goto("/settings/appearance");
  const background = page.getByLabel("Background color", { exact: true });
  const original = await background.inputValue();
  const file = page.getByLabel("Import theme JSON", { exact: true });
  await file.setInputFiles({
    name: "bad.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ background: "invalid" })),
  });
  await expect(
    page.locator("[data-sonner-toast][data-type=error]"),
  ).toBeVisible();
  await expect(background).toHaveValue(original);
  await file.setInputFiles({
    name: "theme.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        accent: "#abcdef",
        density: "compact",
        font: "serif",
        codeFont: "courier",
        lineHeight: 1.8,
        readingWidth: 800,
        reducedMotion: true,
        highContrast: true,
      }),
    ),
  });
  await expect(page.getByLabel("Density", { exact: true })).toHaveValue(
    "compact",
  );
  await expect(page.locator("html")).toHaveAttribute(
    "data-reduced-motion",
    "true",
  );
  await expect
    .poll(() =>
      page.evaluate(() => {
        const style = getComputedStyle(document.documentElement);
        return (
          style.getPropertyValue("--border-default").trim() ===
          style.getPropertyValue("--text-secondary").trim()
        );
      }),
    )
    .toBe(true);
  await page.getByLabel("Theme name", { exact: true }).fill("Reading");
  await page.getByRole("button", { name: "Save a copy", exact: true }).click();
  await expect(page.locator(".appearance-save-status")).toHaveText(
    "Saved to your account",
  );
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Reading", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Reading width", { exact: true })).toHaveValue(
    "800",
  );
  await expect(page.getByLabel("Reduce motion", { exact: true })).toBeChecked();
  await page.getByRole("button", { name: "Snow", exact: true }).click();
  await expect(page.locator(".appearance-save-status")).toHaveText(
    "Saved to your account",
  );
  const still = await page
    .locator("canvas.comic-halftone")
    .evaluateAll((canvases) =>
      canvases.map((canvas) => (canvas as HTMLCanvasElement).toDataURL()),
    );
  expect(still.length).toBeGreaterThan(0);
  await page.waitForTimeout(180);
  expect(
    await page
      .locator("canvas.comic-halftone")
      .evaluateAll((canvases) =>
        canvases.map((canvas) => (canvas as HTMLCanvasElement).toDataURL()),
      ),
  ).toEqual(still);
  await page.getByRole("button", { name: "Modern", exact: true }).click();
  await page.screenshot({
    path: `../../.local/release-${clientVersion}/settings-modern-dark.png`,
  });
  await page.getByRole("button", { name: "Light", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-appearance-mode",
    "light",
  );
  await page.screenshot({
    path: `../../.local/release-${clientVersion}/settings-modern-light.png`,
  });
});

test("server details distinguish the client build and refresh when reopened", async ({
  page,
}) => {
  await login(page);
  let serverVersion = "0.4.0";
  await page.route("**/api/v1/settings/server", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      json: { ...(await response.json()), version: serverVersion },
    });
  });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Server", exact: true }).click();
  const details = page.locator(".server-details");
  await expect(
    details
      .locator("div")
      .filter({ has: page.getByText("Server version", { exact: true }) }),
  ).toContainText("0.4.0");
  await expect(
    details
      .locator("div")
      .filter({ has: page.getByText("Client version", { exact: true }) }),
  ).toContainText(clientVersion);
  await page
    .getByRole("button", { name: "Close settings", exact: true })
    .click();
  serverVersion = "0.4.4";
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Server", exact: true }).click();
  await expect(
    details
      .locator("div")
      .filter({ has: page.getByText("Server version", { exact: true }) }),
  ).toContainText("0.4.4");
});
