import { expect, test, type Page } from "./fixtures";

async function api(page: Page, path: string, body: unknown) {
  return page.evaluate(
    async ({ path, body }) => {
      const csrf =
        document.cookie
          .split("; ")
          .find((value) => value.startsWith("noted_csrf="))
          ?.split("=")[1] ?? "";
      const response = await fetch(`/api/v1${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    },
    { path, body },
  );
}

const lines = (events: unknown[]) =>
  events.map((event) => JSON.stringify(event)).join("\n") + "\n";

test("Ask AI previews a rewrite on the messages and applies it", async ({
  page,
}) => {
  await page.route("**/api/v1/ai/status", (route) =>
    route.fulfill({
      json: { connected: true, plan: "plus", account: "123456", usage: null },
    }),
  );
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill("ilya");
  await page
    .getByLabel("Password", { exact: true })
    .fill("browser-test-password-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".app-shell")).toBeVisible();
  const project = await api(page, "/workspaces", { name: "Animals" });
  const channel = await api(page, `/workspaces/${project.id}/channels`, {
    name: "pets",
  });
  const notes: { id: string }[] = [];
  for (const text of ["dog", "cat", "bird"])
    notes.push(
      await api(page, `/channels/${channel.id}/messages`, { content: text }),
    );
  let sent: Record<string, unknown> | null = null;
  let releaseAnswer: () => void = () => undefined;
  const answerReady = new Promise<void>((resolve) => {
    releaseAnswer = resolve;
  });
  await page.route("**/api/v1/ai/runs", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    sent = route.request().postDataJSON();
    await answerReady;
    const changes = [
      { id: notes[0].id, text: "dog - 4" },
      { id: notes[1].id, text: "cat - 4" },
      { id: notes[2].id, text: "bird - 2" },
    ];
    await route.fulfill({
      contentType: "application/x-ndjson",
      body: lines([
        {
          type: "start",
          run_id: null,
          kind: "rewrite",
          prompt_name: "Custom prompt",
          model: "gpt-6.1-sol",
        },
        { type: "changes", changes: changes.slice(0, 1) },
        { type: "changes", changes },
        { type: "done", output: changes },
      ]),
    });
  });
  await page.goto(`/w/${project.id}/c/${channel.id}`);
  const entries = page.locator(".note-entry");
  await entries.nth(0).locator(".note-gutter").click();
  await entries
    .nth(2)
    .locator(".note-gutter")
    .click({ modifiers: ["Shift"] });
  await page
    .getByRole("toolbar", { name: "Selected messages" })
    .getByRole("button", { name: "Ask AI", exact: true })
    .click();
  const popover = page.getByRole("dialog", { name: "Ask AI" });
  await expect(popover.getByText("Saved prompts")).toBeVisible();
  await expect(
    popover.getByRole("button", { name: /Fix spelling/ }),
  ).toBeVisible();
  await popover.getByRole("textbox", { name: "Prompt" }).fill("how many legs?");
  await popover.getByRole("textbox", { name: "Prompt" }).press("Enter");
  await expect(popover.getByText("Thinking", { exact: true })).toBeVisible();
  releaseAnswer();
  await expect(page.locator(".ai-preview")).toHaveCount(3);
  await expect(page.locator(".ai-preview .ai-after").first()).toHaveText(
    "dog - 4",
  );
  await page.screenshot({ path: "../../.local/ai-rewrite-preview.png" });
  expect(sent).toMatchObject({
    place: "messages",
    instructions: "how many legs?",
    kind: "rewrite",
    message_ids: notes.map((note) => note.id),
  });
  await popover.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(popover).toBeHidden();
  await expect(page.locator(".ai-preview")).toHaveCount(0);
  await expect(
    page.locator(".note").filter({ hasText: "bird - 2" }),
  ).toBeVisible();
  await page
    .locator(".note")
    .filter({ hasText: "dog - 4" })
    .getByRole("button", { name: "edited" })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Edit history" }),
  ).toContainText("dog");
});

test("Settings › AI connects with a pasted auth.json and edits saved prompts", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill("ilya");
  await page
    .getByLabel("Password", { exact: true })
    .fill("browser-test-password-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  await dialog.getByRole("button", { name: "AI", exact: true }).click();
  await expect(
    dialog.getByText("Connect ChatGPT to use AI in Noted"),
  ).toBeVisible();
  await page.route("**/api/v1/ai/models", (route) =>
    route.fulfill({ json: [] }),
  );
  await expect(
    dialog.getByRole("link", { name: "Sign in with ChatGPT" }),
  ).toHaveAttribute("href", /^https:\/\/auth\.openai\.com\/oauth\/authorize\?/);
  await dialog
    .getByRole("button", { name: "Or paste auth.json from codex login" })
    .click();
  await dialog.getByLabel(/Paste auth.json/).fill(
    JSON.stringify({
      tokens: {
        access_token: "a.e30.b",
        refresh_token: "r",
        account_id: "acct-abcdef",
      },
    }),
  );
  await dialog.getByRole("button", { name: "Connect with auth.json" }).click();
  await expect(dialog.getByText("Account …abcdef")).toBeVisible();
  await expect(dialog.getByLabel("Model")).toHaveValue("gpt-6.1-sol");
  await dialog.getByRole("radio", { name: "High", exact: true }).click();
  await expect(
    dialog.getByRole("radio", { name: "High", exact: true }),
  ).toHaveAttribute("aria-checked", "true");
  await dialog
    .getByRole("button", { name: "Saved prompts", exact: true })
    .click();
  await dialog.getByRole("button", { name: /Make shorter/ }).click();
  await dialog.getByLabel("Name", { exact: true }).fill("Shorter");
  await dialog.getByRole("radio", { name: /^Answer/ }).click();
  await dialog.getByRole("button", { name: "Save prompt" }).click();
  await expect(dialog.locator(".ai-prompt-list")).toContainText("Shorter");
  await page.screenshot({ path: "../../.local/ai-settings-prompts.png" });
  await dialog.getByRole("button", { name: "AI", exact: true }).click();
  await dialog.getByRole("button", { name: "Disconnect" }).click();
  await page
    .getByRole("dialog", { name: "Disconnect ChatGPT?" })
    .getByRole("button", { name: "Disconnect" })
    .click();
  await expect(
    dialog.getByText("Connect ChatGPT to use AI in Noted"),
  ).toBeVisible();
});

test("Ask AI targets one message without selection and replies from the mobile menu", async ({
  page,
}) => {
  await page.route("**/api/v1/ai/status", (route) =>
    route.fulfill({ json: { connected: true } }),
  );
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill("ilya");
  await page
    .getByLabel("Password", { exact: true })
    .fill("browser-test-password-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".app-shell")).toBeVisible();
  const project = await api(page, "/workspaces", { name: "Direct AI" });
  const channel = await api(page, `/workspaces/${project.id}/channels`, {
    name: "thoughts",
  });
  const first = await api(page, `/channels/${channel.id}/messages`, {
    content: "Leave this alone",
  });
  const second = await api(page, `/channels/${channel.id}/messages`, {
    content: "hello wrld",
  });
  const requests: Record<string, unknown>[] = [];
  await page.route("**/api/v1/ai/runs", (route) => {
    const input = route.request().postDataJSON();
    requests.push(input);
    const output =
      input.kind === "rewrite"
        ? [{ id: input.message_ids[0], text: "Hello world" }]
        : "A thoughtful reply";
    return route.fulfill({
      contentType: "application/x-ndjson",
      body: lines([
        {
          type: "start",
          run_id: null,
          kind: input.kind,
          prompt_name: "Custom prompt",
          model: "gpt-6.1-sol",
        },
        input.kind === "rewrite"
          ? { type: "changes", changes: output }
          : { type: "text", text: output },
        { type: "done", output },
      ]),
    });
  });
  await page.goto(`/w/${project.id}/c/${channel.id}`);
  const original = page.locator(`#note-${first.id}`);
  const message = page.locator(`#note-${second.id}`);
  await message.hover();
  await message.getByRole("button", { name: "Ask AI", exact: true }).click();
  const popup = page.getByRole("dialog", { name: "Ask AI", exact: true });
  await expect(popup).toContainText("1 message");
  await expect(
    page.getByRole("toolbar", { name: "Selected messages" }),
  ).toHaveCount(0);
  await popup
    .getByRole("textbox", { name: "Prompt", exact: true })
    .fill("Fix spelling");
  await popup
    .getByRole("textbox", { name: "Prompt", exact: true })
    .press("Enter");
  await expect(message.locator(".ai-preview .ai-after")).toHaveText(
    "Hello world",
  );
  await expect(original.locator(".ai-preview")).toHaveCount(0);
  expect(requests[0].message_ids).toEqual([second.id]);
  await popup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(popup).toBeHidden();
  await expect(message.locator(".markdown")).toHaveText("Hello world");
  await expect(original.locator(".markdown")).toHaveText("Leave this alone");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await original
    .getByRole("button", { name: "Note options", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Ask AI", exact: true }).click();
  await expect(popup).toBeVisible();
  await popup.getByRole("radio", { name: "Reply", exact: true }).click();
  await popup
    .getByRole("textbox", { name: "Prompt", exact: true })
    .fill("Reply to this");
  await popup
    .getByRole("textbox", { name: "Prompt", exact: true })
    .press("Enter");
  await expect(popup.locator(".ask-ai-answer")).toHaveText(
    "A thoughtful reply",
  );
  expect(requests[1].message_ids).toEqual([first.id]);
  await popup.getByRole("button", { name: "Add reply", exact: true }).click();
  await expect(popup).toBeHidden();
  await original
    .getByRole("button", { name: "Open thread", exact: true })
    .click();
  const thread = page.locator(".writing-sidebar");
  const reply = thread
    .locator(".note")
    .filter({ hasText: "A thoughtful reply" });
  await expect(reply).toBeVisible();
  await reply.getByRole("button", { name: "Ask AI", exact: true }).click();
  await popup
    .getByRole("textbox", { name: "Prompt", exact: true })
    .fill("Rewrite this reply");
  await popup
    .getByRole("textbox", { name: "Prompt", exact: true })
    .press("Enter");
  await expect(reply.locator(".ai-preview .ai-after")).toHaveText(
    "Hello world",
  );
  await popup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(thread.locator(".note .markdown")).toHaveText("Hello world");
  await expect(
    page.getByRole("toolbar", { name: "Selected messages" }),
  ).toHaveCount(0);
});
