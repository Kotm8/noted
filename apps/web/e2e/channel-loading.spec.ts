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

async function setup(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill("ilya");
  await page
    .getByLabel("Password", { exact: true })
    .fill("browser-test-password-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".app-shell")).toBeVisible();
  const workspace = await api(page, "/workspaces", "POST", {
    name: "Prepared channels",
  });
  const first = await api(
    page,
    `/workspaces/${workspace.id}/channels`,
    "POST",
    { name: "first", position: 0 },
  );
  const slow = await api(page, `/workspaces/${workspace.id}/channels`, "POST", {
    name: "slow",
    position: 1,
  });
  const third = await api(
    page,
    `/workspaces/${workspace.id}/channels`,
    "POST",
    { name: "third", position: 2 },
  );
  for (const item of [first, slow, third])
    await api(page, `/channels/${item.id}/messages`, "POST", {
      content: `${item.name} content ready`,
    });
  await page.goto(`/w/${workspace.id}/c/${first.id}`);
  await expect(page.locator(".note .markdown")).toContainText(
    "first content ready",
  );
  return { workspace, first, slow, third };
}

async function hold(page: Page, pattern: string, status?: number) {
  let release!: () => void;
  let arrived!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  await page.route(pattern, async (route) => {
    arrived();
    await gate;
    if (status)
      await route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Channel could not be loaded" }),
      });
    else await route.continue();
  });
  return { release, started };
}

test("channel clicks preserve the current page and draft until messages are ready", async ({
  page,
}) => {
  const { first, slow } = await setup(page);
  const gate = await hold(page, `**/channels/${slow.id}/messages?*`);
  try {
    await page
      .getByRole("textbox", { name: "Message first" })
      .fill("Keep my draft while waiting");
    await page
      .locator(".channel-tree")
      .getByRole("button", { name: "slow", exact: true })
      .click();
    await gate.started;
    await expect(
      page.getByRole("heading", { name: "first", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "Message first" }),
    ).toHaveValue("Keep my draft while waiting");
    await expect(page).toHaveURL(new RegExp(`/c/${first.id}$`));
    await expect(page.locator(".feed-loading")).toHaveCount(0);
    gate.release();
    await expect(
      page.getByRole("heading", { name: "slow", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".note .markdown")).toContainText(
      "slow content ready",
    );
    await expect(page.locator(".feed-loading")).toHaveCount(0);
    await page
      .locator(".channel-tree")
      .getByRole("button", { name: "first", exact: true })
      .click();
    await expect(
      page.getByRole("textbox", { name: "Message first" }),
    ).toHaveValue("Keep my draft while waiting");
  } finally {
    gate.release();
  }
});

test("a late response cannot replace a newer channel selection", async ({
  page,
}) => {
  const { slow } = await setup(page);
  const gate = await hold(page, `**/channels/${slow.id}/messages?*`);
  try {
    await page
      .locator(".channel-tree")
      .getByRole("button", { name: "slow", exact: true })
      .click();
    await gate.started;
    await page
      .locator(".channel-tree")
      .getByRole("button", { name: "third", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "third", exact: true }),
    ).toBeVisible();
    const response = page.waitForResponse((item) =>
      item.url().includes(`/channels/${slow.id}/messages?`),
    );
    gate.release();
    await (await response).finished();
    await page.waitForLoadState("networkidle");
    await expect(
      page.getByRole("heading", { name: "third", exact: true }),
    ).toBeVisible();
  } finally {
    gate.release();
  }
});

test("a failed destination keeps the current channel usable and can be retried", async ({
  page,
}) => {
  const { slow } = await setup(page);
  const pattern = `**/channels/${slow.id}/messages?*`;
  const gate = await hold(page, pattern, 503);
  await page
    .locator(".channel-tree")
    .getByRole("button", { name: "slow", exact: true })
    .click();
  await gate.started;
  gate.release();
  await expect(
    page.getByText("Channel could not be loaded", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Message first" }),
  ).toBeVisible();
  await expect(page.locator(".feed-loading")).toHaveCount(0);
  await page.unroute(pattern);
  await page
    .locator(".channel-tree")
    .getByRole("button", { name: "slow", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "slow", exact: true }),
  ).toBeVisible();
});

test("journals and Markdown pages are prepared before the channel changes", async ({
  page,
}) => {
  const { workspace } = await setup(page);
  for (const kind of ["journal", "document"]) {
    const channel = await api(
      page,
      `/workspaces/${workspace.id}/channels`,
      "POST",
      { name: kind, kind },
    );
    await page.reload();
    await expect(
      page.getByRole("textbox", { name: "Message first" }),
    ).toBeVisible();
    const pattern =
      kind === "journal"
        ? `**/channels/${channel.id}/journal?*`
        : `**/channels/${channel.id}/document`;
    const gate = await hold(page, pattern);
    try {
      await page
        .locator(".channel-tree")
        .getByRole("button", { name: kind, exact: true })
        .click();
      await gate.started;
      await expect(
        page.getByRole("textbox", { name: "Message first" }),
      ).toBeVisible();
      gate.release();
      await expect(
        page
          .locator(".channel-header")
          .getByRole("heading", { name: kind, exact: true }),
      ).toBeVisible();
      await expect(page.locator(".channel-document-loading")).toHaveCount(0);
      await expect(
        page.getByText("Opening entries…", { exact: true }),
      ).toHaveCount(0);
      await page
        .locator(".channel-tree")
        .getByRole("button", { name: "first", exact: true })
        .click();
      await expect(
        page.getByRole("textbox", { name: "Message first" }),
      ).toBeVisible();
    } finally {
      gate.release();
    }
  }
});

test("Android startup keeps the drawn logo until the first channel is ready", async ({
  page,
}) => {
  await page.setViewportSize({ width: 412, height: 892 });
  const { workspace, slow } = await setup(page);
  const gate = await hold(page, `**/channels/${slow.id}/messages?*`);
  try {
    await page.goto(
      `/w/${workspace.id}/c/${slow.id}?client=android&nativePush=1`,
    );
    await gate.started;
    await expect(page.locator("#noted-startup")).toBeVisible();
    await expect(page.locator(".app-shell")).toHaveCount(0);
    await page.screenshot({
      path: "../../.local/screenshots/startup-before-channel-ready.png",
    });
    gate.release();
    await expect(page.locator("#noted-startup")).toHaveCount(0);
    await expect(page.locator(".note .markdown")).toContainText(
      "slow content ready",
    );
    await expect(page.locator(".feed-loading")).toHaveCount(0);
  } finally {
    gate.release();
  }
});

test("Home startup keeps the logo until the agenda and missed activity are ready", async ({
  page,
}) => {
  await page.setViewportSize({ width: 412, height: 892 });
  await setup(page);
  const gate = await hold(page, "**/home/activity?limit=50");
  try {
    await page.goto("/?client=android&nativePush=1");
    await gate.started;
    await expect(page.locator("#noted-startup")).toBeVisible();
    await expect(page.locator(".app-shell")).toHaveCount(0);
    gate.release();
    await expect(page.locator("#noted-startup")).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Home", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Loading missed activity…", { exact: true }),
    ).toHaveCount(0);
  } finally {
    gate.release();
  }
});

test("startup falls back from a deleted channel without exposing a loading view", async ({
  page,
}) => {
  const { workspace, first, slow } = await setup(page);
  await api(page, `/channels/${slow.id}`, "DELETE");
  await page.goto(`/w/${workspace.id}/c/${slow.id}`);
  await expect(page).toHaveURL(new RegExp(`/c/${first.id}$`));
  await expect(page.locator("#noted-startup")).toHaveCount(0);
  await expect(page.locator(".note .markdown")).toContainText(
    "first content ready",
  );
  await expect(page.locator(".feed-loading")).toHaveCount(0);
});

test("startup failures offer recovery without leaving an empty page", async ({
  page,
}) => {
  const { workspace, slow } = await setup(page);
  const pattern = `**/channels/${slow.id}/messages?*`;
  const gate = await hold(page, pattern, 503);
  gate.release();
  await page.goto(`/w/${workspace.id}/c/${slow.id}`);
  await expect(
    page.getByRole("heading", { name: "Let's reconnect." }),
  ).toBeVisible();
  await expect(page.locator("#noted-startup")).toHaveCount(0);
  await page.unroute(pattern);
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.locator(".note .markdown")).toContainText(
    "slow content ready",
  );
  await expect(page.locator(".feed-loading")).toHaveCount(0);
});
