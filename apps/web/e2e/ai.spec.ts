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

test("Ask AI attaches messages to the assistant, previews a rewrite on them and applies it", async ({
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
  await page.route("**/api/v1/ai/assistant", async (route) => {
    sent = route.request().postDataJSON();
    await answerReady;
    const output = {
      explanation: "Added the number of **legs**.",
      habits: [],
      plans: [],
      meals: [],
      rewrites: [
        { id: notes[0].id, text: "dog - 4" },
        { id: notes[1].id, text: "cat - 4" },
        { id: notes[2].id, text: "bird - 2" },
      ],
    };
    await route.fulfill({
      contentType: "application/x-ndjson",
      body: lines([
        { type: "chat", chat_id: crypto.randomUUID() },
        { type: "explanation", text: "Added the number" },
        { type: "turn", turn_id: crypto.randomUUID() },
        { type: "done", output, sources: [] },
      ]),
    });
  });
  await page.route("**/api/v1/ai/assistant/apply", (route) =>
    route.fulfill({ json: { habits: [], plans: [], meals: [], pictures: [] } }),
  );
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
  const panel = page.getByRole("complementary", { name: "AI assistant" });
  await expect(panel.getByText("3 messages in #pets")).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Fix spelling", exact: true }),
  ).toBeVisible();
  const input = panel.getByRole("textbox", { name: "Message assistant" });
  await expect(input).toBeFocused();
  await input.fill("how many legs?");
  await input.press("Enter");
  await expect(panel.getByRole("status")).toContainText("Thinking");
  releaseAnswer();
  await expect(page.locator(".ai-preview")).toHaveCount(3);
  await expect(page.locator(".ai-preview .ai-after").first()).toHaveText(
    "dog - 4",
  );
  await expect(panel.locator(".shared-ai-turn.assistant strong")).toHaveText(
    "legs",
  );
  expect(sent).toMatchObject({
    instructions: "how many legs?",
    context: {
      channel_id: channel.id,
      message_ids: notes.map((note) => note.id),
    },
  });
  await panel.getByLabel("Include rewrite 2").uncheck();
  await expect(page.locator(".ai-preview")).toHaveCount(2);
  await panel.getByRole("button", { name: "Apply changes" }).click();
  await expect(page.locator(".ai-preview")).toHaveCount(0);
  await expect(
    page.locator(".note").filter({ hasText: "bird - 2" }),
  ).toBeVisible();
  await expect(
    page.locator(".note .markdown").filter({ hasText: /^cat$/ }),
  ).toHaveCount(1);
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

test("Ask AI on one message drafts, and asking in a thread posts the reply there", async ({
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
    content: "Ideas for the weekend?",
  });
  const second = await api(page, `/channels/${channel.id}/messages`, {
    content: "hello wrld",
  });
  interface Sent {
    context: {
      message_ids: string[];
      thread_root_id?: string | null;
      prompt_id?: string | null;
    };
  }
  const requests: Sent[] = [];
  await page.route("**/api/v1/ai/assistant", async (route) => {
    const input = route.request().postDataJSON();
    requests.push(input);
    const inThread = Boolean(input.context?.thread_root_id);
    let posted = null;
    if (inThread) {
      // The server posts the reply itself; the stand-in does the same through the API.
      const reply = await api(
        page,
        `/messages/${input.context.thread_root_id}/thread`,
        { content: "Hike, then the market." },
      );
      posted = {
        message_id: reply.id,
        thread_root_id: input.context.thread_root_id,
        channel_id: channel.id,
      };
    }
    const output = {
      explanation: inThread ? "Replied with two ideas." : "Here's a draft.",
      habits: [],
      plans: [],
      meals: [],
      rewrites: [],
      draft: inThread ? null : "Hello world, friends",
      reply: inThread ? "Hike, then the market." : null,
      posted,
    };
    await route.fulfill({
      contentType: "application/x-ndjson",
      body: lines([
        { type: "chat", chat_id: crypto.randomUUID() },
        { type: "turn", turn_id: crypto.randomUUID() },
        { type: "done", output, sources: [] },
      ]),
    });
  });
  await page.goto(`/w/${project.id}/c/${channel.id}`);
  const message = page.locator(`#note-${second.id}`);
  await message.hover();
  await message.getByRole("button", { name: "Ask AI", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "AI assistant" });
  await expect(panel.getByText("Message in #thoughts")).toBeVisible();
  await expect(
    page.getByRole("toolbar", { name: "Selected messages" }),
  ).toHaveCount(0);
  const input = panel.getByRole("textbox", { name: "Message assistant" });
  await input.fill("Write this as a proper message");
  await input.press("Enter");
  await expect(panel.locator(".shared-ai-draft")).toContainText(
    "Hello world, friends",
  );
  expect(requests[0].context.message_ids).toEqual([second.id]);
  await panel.getByRole("button", { name: "Put in message box" }).click();
  await expect(
    page.getByRole("textbox", { name: "Message thoughts" }),
  ).toHaveValue("Hello world, friends");

  const root = page.locator(`#note-${first.id}`);
  await root.hover();
  await root.getByRole("button", { name: "Open thread", exact: true }).click();
  const thread = page.locator(".writing-sidebar");
  await thread
    .getByRole("button", { name: "Ask AI in this thread", exact: true })
    .click();
  await expect(panel.getByText("Thread in #thoughts")).toBeVisible();
  await panel
    .getByRole("button", { name: "Ideas for this", exact: true })
    .click();
  expect(requests[1].context).toMatchObject({
    thread_root_id: first.id,
    message_ids: [first.id],
  });
  expect(requests[1].context.prompt_id).toBeTruthy();
  await expect(panel.getByText("Replied in the thread")).toBeVisible();
  await expect(
    thread.locator(".note").filter({ hasText: "Hike, then the market." }),
  ).toBeVisible();
});
