import { expect, test, type Page } from "@playwright/test";

async function api(page: Page, path: string, method = "GET", body?: unknown) {
  return page.evaluate(
    async ({ path, method, body }) => {
      const csrf =
        document.cookie
          .split("; ")
          .find((entry) => entry.startsWith("noted_csrf="))
          ?.slice(11) ?? "";
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

async function openChannel(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill("ilya");
  await page
    .getByLabel("Password", { exact: true })
    .fill("browser-test-password-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".app-shell")).toBeVisible();
  const project = await api(page, "/workspaces", "POST", {
    name: `Scheduled ${Date.now()}`,
  });
  const channel = await api(
    page,
    `/workspaces/${project.id}/channels`,
    "POST",
    { name: "daily-writing" },
  );
  await page.goto(`/w/${project.id}/c/${channel.id}`);
  return channel;
}

test("schedule, review, edit and cancel without losing the draft", async ({
  page,
}) => {
  await openChannel(page);
  const composer = page.getByRole("textbox", {
    name: "Message daily-writing",
    exact: true,
  });
  await composer.fill("A little note for later");
  await page
    .getByRole("button", { name: "Schedule message", exact: true })
    .click();
  let dialog = page.getByRole("dialog", { name: "Send later", exact: true });
  await expect(dialog.getByLabel("Scheduled message")).toHaveValue(
    "A little note for later",
  );
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(composer).toHaveValue("A little note for later");
  await page
    .getByRole("button", { name: "Schedule message", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Schedule message", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(composer).toHaveValue("");
  await page.getByRole("button", { name: "Channel options" }).click();
  await page
    .getByRole("menuitem", { name: "Scheduled messages", exact: true })
    .click();
  const queue = page.getByRole("dialog", {
    name: "#daily-writing",
    exact: true,
  });
  await expect(
    queue.getByText("A little note for later", { exact: true }),
  ).toBeVisible();
  await queue
    .getByRole("button", { name: "Edit scheduled message", exact: true })
    .click();
  dialog = page.getByRole("dialog", {
    name: "Edit scheduled message",
    exact: true,
  });
  await dialog
    .getByLabel("Scheduled message")
    .fill("Updated before it goes out");
  await dialog
    .getByRole("button", { name: "Schedule message", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(
    queue.getByText("Updated before it goes out", { exact: true }),
  ).toBeVisible();
  await queue
    .getByRole("button", { name: "Cancel scheduled message", exact: true })
    .click();
  await expect(queue.getByText("Cancelled", { exact: true })).toBeVisible();
  await page.screenshot({
    path: "../../.local/screenshots/channel-scheduling.png",
  });
  await queue
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  const file = {
    name: "hello.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("hello"),
  };
  await composer.fill("With a file");
  await page.getByLabel("Attach files").setInputFiles(file);
  await expect(
    page.getByRole("button", { name: "Schedule message", exact: true }),
  ).toBeDisabled();
  await expect(composer).toHaveValue("With a file");
});

test("recurring writing prompt and queued message fire on the server; writing completes the prompt", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const channel = await openChannel(page);
  await page.getByRole("button", { name: "Channel options" }).click();
  await page
    .getByRole("menuitem", { name: "Writing prompt", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "#daily-writing",
    exact: true,
  });
  await dialog
    .getByLabel("Writing prompt text")
    .fill("What did you learn today?");
  await dialog.getByRole("button", { name: "Writing prompt repeat" }).click();
  await page
    .getByRole("menuitemradio", { name: "Every two weeks", exact: true })
    .click();
  await dialog.getByRole("button", { name: "Mon", exact: true }).click();
  await dialog.getByRole("button", { name: "Fri", exact: true }).click();
  await dialog
    .getByRole("button", { name: "Save writing prompt", exact: true })
    .click();
  await expect(
    page.getByText("Writing prompt saved", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "../../.local/screenshots/writing-prompt-settings.png",
  });
  await dialog
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  const saved = await api(page, `/channels/${channel.id}/writing-prompt`);
  expect(saved.frequency).toBe("biweekly");
  const due = new Date(Date.now() + 7000).toISOString();
  const { content, timezone, revision, enabled } = saved;
  await api(page, `/channels/${channel.id}/writing-prompt`, "PUT", {
    content,
    timezone,
    revision,
    enabled,
    start_at: due,
    frequency: "daily",
    weekdays: [],
  });
  await api(page, `/channels/${channel.id}/scheduled-messages`, "POST", {
    content: "Published by the server",
    send_at: due,
    timezone: "UTC",
  });
  await expect(
    page.locator(".note").getByText("Published by the server", { exact: true }),
  ).toBeVisible({ timeout: 25000 });
  await expect(page.locator(".writing-prompt-banner")).toContainText(
    "What did you learn today?",
    { timeout: 15000 },
  );
  await page
    .getByRole("textbox", { name: "Message daily-writing", exact: true })
    .fill("I learned something new.");
  await page.getByRole("button", { name: "Send note", exact: true }).click();
  await expect(page.locator(".writing-prompt-banner")).toHaveCount(0);
  expect(
    (await api(page, `/channels/${channel.id}/writing-prompt`)).due_at,
  ).toBeNull();
  expect(errors).toEqual([]);
});
