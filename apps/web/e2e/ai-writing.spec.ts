import { expect, test, type Page } from "./fixtures";

async function api(page: Page, path: string, body?: unknown, method = "POST") {
  return page.evaluate(
    async ({ path, body, method }) => {
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
      return response.json();
    },
    { path, body, method },
  );
}

async function login(page: Page) {
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
}

async function channel(page: Page, kind: "journal" | "document") {
  const project = await api(page, "/workspaces", { name: "Writing" });
  const channel = await api(page, `/workspaces/${project.id}/channels`, {
    name: kind === "journal" ? "daily-log" : "porto-trip",
    kind,
  });
  return { ...channel, projectId: project.id };
}

async function entry(
  page: Page,
  channelId: string,
  title: string,
  content: string,
) {
  const created = await api(page, `/channels/${channelId}/journal`, { title });
  return api(
    page,
    `/journal/${created.id}`,
    { title, content, revision: created.revision },
    "PUT",
  );
}

async function mockRuns(
  page: Page,
  answer = "Useful summary",
  requests: Record<string, unknown>[] = [],
) {
  const saved = await api(page, "/ai/prompts", undefined, "GET");
  const names = new Map(
    saved.map((item: { id: string; name: string }) => [item.id, item.name]),
  );
  return page.route("**/api/v1/ai/runs", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const input = route.request().postDataJSON();
    requests.push(input);
    const events = [
      {
        type: "start",
        run_id: null,
        kind: input.kind ?? "answer",
        prompt_name: names.get(input.prompt_id) ?? "Custom prompt",
        model: "gpt-6.1-sol",
      },
      { type: "thinking", heading: "Reading your writing" },
      { type: "search", query: "Porto train times" },
      { type: "text", text: answer, thought_seconds: 3 },
      {
        type: "sources",
        sources: [{ url: "https://example.com/trains", title: "Train times" }],
      },
      {
        type: "done",
        output: answer,
        thought_seconds: 3,
        searched: true,
        sources: [{ url: "https://example.com/trains", title: "Train times" }],
      },
    ];
    await route.fulfill({
      contentType: "application/x-ndjson",
      body: events.map((event) => JSON.stringify(event)).join("\n") + "\n",
    });
  });
}

for (const phone of [false, true]) {
  test(`journal selection, persistent rewrite preview, apply and undo${phone ? " on phone" : ""}`, async ({
    page,
  }) => {
    if (phone) await page.setViewportSize({ width: 390, height: 844 });
    await login(page);
    const journal = await channel(page, "journal");
    await entry(
      page,
      journal.id,
      "Sunday notes",
      "Coffee first.\n\nFix teh speling here.\n\nKeep this ending.",
    );
    const requests: Record<string, unknown>[] = [];
    await mockRuns(page, "Fix the spelling here.", requests);
    await page.goto(`/w/${journal.projectId}/c/${journal.id}`);
    await page.getByRole("button", { name: /Sunday notes/ }).click();
    const sidebar = page.locator(".writing-sidebar");
    await sidebar.getByRole("button", { name: "Ask AI", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Ask AI" })).toBeVisible();
    await sidebar.getByRole("heading", { name: "Journal entry" }).click();
    await expect(page.getByRole("dialog", { name: "Ask AI" })).toBeHidden();
    await sidebar
      .locator(".journal-reading p")
      .nth(1)
      .evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        window.getSelection()!.removeAllRanges();
        window.getSelection()!.addRange(range);
      });
    await sidebar
      .getByRole("button", { name: "Ask AI about selected text" })
      .click();
    await expect(
      page.getByRole("button", { name: "Selected text", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("dialog", { name: "Ask AI" })
      .getByRole("button", { name: /Fix spelling/ })
      .click();
    await expect(sidebar.getByLabel("Rewrite preview")).toBeVisible();
    expect(requests[0].text).toBe("Fix teh speling here.");
    await sidebar.getByRole("heading", { name: "Journal entry" }).click();
    await expect(sidebar.getByLabel("Rewrite preview")).toBeVisible();
    await page.screenshot({
      path: `../../.local/ai-writing-j1${phone ? "-phone" : ""}.png`,
    });
    await sidebar.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(sidebar.locator(".journal-reading")).toContainText(
      "Fix the spelling here.",
    );
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(sidebar.locator(".journal-reading")).toContainText(
      "Fix teh speling here.",
    );
  });

  test(`document chat, follow-up, sources, insert preview and retained conversation${phone ? " on phone" : ""}`, async ({
    page,
  }) => {
    if (phone) await page.setViewportSize({ width: 390, height: 844 });
    await login(page);
    const document = await channel(page, "document");
    await api(
      page,
      `/channels/${document.id}/document`,
      { content: "Book a train.\n\nKeep my packing list.", revision: 0 },
      "PUT",
    );
    const requests: Record<string, unknown>[] = [];
    await mockRuns(page, "- [ ] Reserve a seat", requests);
    await page.goto(`/w/${document.projectId}/c/${document.id}`);
    await page.getByRole("button", { name: "Edit note", exact: true }).click();
    const input = page.getByRole("textbox", { name: "Note contents" });
    await input.evaluate((element: HTMLTextAreaElement) => {
      element.focus();
      element.setSelectionRange(4, 4);
      element.dispatchEvent(new Event("select", { bubbles: true }));
    });
    await page.getByRole("button", { name: "Ask AI", exact: true }).click();
    await page
      .getByRole("textbox", { name: "AI prompt" })
      .fill("What should I book?");
    await page.getByRole("textbox", { name: "AI prompt" }).press("Enter");
    const chat = page.getByRole("complementary", {
      name: "Ask about porto-trip",
    });
    await expect(chat).toContainText("Reserve a seat");
    await expect(chat.getByRole("link", { name: /example.com/ })).toBeVisible();
    await expect(chat.locator('input[type="checkbox"]')).toBeVisible();
    await chat
      .getByRole("textbox", { name: "Follow-up question" })
      .fill("And tomorrow?");
    await chat
      .getByRole("textbox", { name: "Follow-up question" })
      .press("Enter");
    await expect(chat.locator(".ai-chat-turn")).toHaveCount(2);
    expect(requests[1].history).toHaveLength(2);
    expect(requests[1].text).toBe("Book a train.\n\nKeep my packing list.");
    await chat
      .getByRole("button", { name: "Insert", exact: true })
      .last()
      .click();
    await expect(page.getByLabel("AI insertion preview")).toContainText(
      "Inserts here, where your cursor was",
    );
    await page.screenshot({
      path: `../../.local/ai-writing-d2${phone ? "-phone" : ""}.png`,
    });
    await page
      .getByLabel("AI insertion preview")
      .getByRole("button", { name: "Insert", exact: true })
      .click();
    await expect(input).toHaveValue(
      "Book a train.\n\n- [ ] Reserve a seat\n\nKeep my packing list.",
    );
    if (!phone)
      await chat.getByRole("button", { name: "Close AI chat" }).click();
    await page.getByRole("button", { name: "Ask AI", exact: true }).click();
    await expect(chat.locator(".ai-chat-turn")).toHaveCount(2);
    expect(requests).toHaveLength(2);
  });
}

test("journal answer can append a quote or save and open a new entry", async ({
  page,
}) => {
  await login(page);
  const journal = await channel(page, "journal");
  await entry(page, journal.id, "Sunday notes", "My original writing.");
  await mockRuns(page);
  await page.goto(`/w/${journal.projectId}/c/${journal.id}`);
  await page.getByRole("button", { name: /Sunday notes/ }).click();
  const sidebar = page.locator(".writing-sidebar");
  await sidebar.getByRole("button", { name: "Ask AI", exact: true }).click();
  await page.getByRole("textbox", { name: "AI prompt" }).fill("What matters?");
  await page.getByRole("textbox", { name: "AI prompt" }).press("Enter");
  await page.getByRole("button", { name: "Add to entry", exact: true }).click();
  await expect(sidebar.locator("blockquote")).toHaveText("Useful summary");
  await sidebar.getByRole("button", { name: "Ask AI", exact: true }).click();
  await page.getByRole("textbox", { name: "AI prompt" }).press("Enter");
  await page
    .getByRole("button", { name: "Save as new entry", exact: true })
    .click();
  await expect(
    sidebar.getByRole("textbox", { name: "Entry title" }),
  ).toHaveValue("Useful summary");
  await expect(sidebar.locator(".journal-reading")).toContainText(
    "Useful summary",
  );
});

test("Look back picks journal entries and saves a review", async ({ page }) => {
  await login(page);
  const journal = await channel(page, "journal");
  const first = await entry(page, journal.id, "Monday", "A focused morning.");
  await entry(page, journal.id, "Tuesday", "An afternoon outside.");
  const requests: Record<string, unknown>[] = [];
  await mockRuns(page, "A thoughtful week.", requests);
  await page.goto(`/w/${journal.projectId}/c/${journal.id}`);
  await page.getByRole("button", { name: "Ask AI", exact: true }).click();
  const popover = page.getByRole("dialog", { name: "Look back" });
  await popover
    .getByRole("button", { name: "Pick entries", exact: true })
    .click();
  await page.getByRole("button", { name: /Monday/ }).click();
  await expect(popover).toBeVisible();
  await popover.getByRole("button", { name: /Weekly review/ }).click();
  await expect(popover).toContainText("A thoughtful week.");
  expect(requests[0].entry_ids).toEqual([first.id]);
  await expect(popover.locator(".ai-from-entries")).toContainText("Monday");
  await page.screenshot({ path: "../../.local/ai-writing-j3.png" });
  await popover
    .getByRole("button", { name: "Save as new entry", exact: true })
    .click();
  await expect(
    page
      .locator(".writing-sidebar")
      .getByRole("textbox", { name: "Entry title" }),
  ).toHaveValue("Weekly review");
});

test("document editing preserves a selected source range for rewrite", async ({
  page,
}) => {
  await login(page);
  const document = await channel(page, "document");
  await api(
    page,
    `/channels/${document.id}/document`,
    { content: "Before.\n\nunpolished words\n\nAfter.", revision: 0 },
    "PUT",
  );
  const requests: Record<string, unknown>[] = [];
  await mockRuns(page, "Polished words", requests);
  await page.goto(`/w/${document.projectId}/c/${document.id}`);
  await page.getByRole("button", { name: "Edit note", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Note contents" })
    .evaluate((element: HTMLTextAreaElement) => {
      element.focus();
      const start = element.value.indexOf("unpolished");
      element.setSelectionRange(start, start + "unpolished words".length);
      element.dispatchEvent(new Event("select", { bubbles: true }));
    });
  await page.getByRole("button", { name: "Ask AI", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Ask AI" })
    .getByRole("button", { name: /Fix spelling/ })
    .click();
  await expect(page.getByLabel("Rewrite preview")).toContainText(
    "Polished words",
  );
  expect(requests[0].text).toBe("unpolished words");
  await page.keyboard.press("Control+Enter");
  await expect(
    page.getByRole("textbox", { name: "Note contents" }),
  ).toHaveValue("Before.\n\nPolished words\n\nAfter.");
});

test("a rewrite cannot overwrite an entry changed on another device", async ({
  page,
}) => {
  await login(page);
  const journal = await channel(page, "journal");
  const original = await entry(
    page,
    journal.id,
    "Shared entry",
    "Original words.",
  );
  await mockRuns(page, "Rewritten words.");
  await page.goto(`/w/${journal.projectId}/c/${journal.id}`);
  await page.getByRole("button", { name: /Shared entry/ }).click();
  const sidebar = page.locator(".writing-sidebar");
  await sidebar.getByRole("button", { name: "Ask AI", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Ask AI" })
    .getByRole("button", { name: /Fix spelling/ })
    .click();
  await expect(sidebar.getByLabel("Rewrite preview")).toBeVisible();
  await api(
    page,
    `/journal/${original.id}`,
    {
      title: "Shared entry",
      content: "Changed on my phone.",
      revision: original.revision,
    },
    "PUT",
  );
  await sidebar.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(sidebar.locator(".ai-writing-error")).toContainText(
    "changed on another device",
  );
  expect(
    (await api(page, `/journal/${original.id}`, undefined, "GET")).content,
  ).toBe("Changed on my phone.");
  await page.keyboard.press("Escape");
  await expect(sidebar.getByLabel("Rewrite preview")).toBeHidden();
});

test("document chat reopens saved conversations and can start a new one", async ({
  page,
}) => {
  await login(page);
  const document = await channel(page, "document");
  await mockRuns(page);
  const conversationId = "11111111-1111-4111-8111-111111111111";
  await page.route("**/api/v1/ai/conversations**", (route) =>
    route.fulfill({
      json: route.request().url().includes(`/${conversationId}`)
        ? [
            {
              id: "22222222-2222-4222-8222-222222222222",
              conversation_id: conversationId,
              instructions: "An earlier question",
              prompt_name: "Custom prompt",
              kind: "answer",
              place: "documents",
              channel_id: document.id,
              created_at: "2026-11-01T12:00:00Z",
              where: "porto-trip",
              model: "gpt-6.1-sol",
              input: [{ text: "Earlier document" }],
              output: "An earlier answer.",
              outcome: "ready",
              error: null,
              usage: {
                thought_seconds: 2,
                sources: [
                  {
                    url: "https://example.com/history",
                    title: "Earlier source",
                  },
                ],
              },
            },
          ]
        : [
            {
              id: conversationId,
              question: "An earlier question",
              turns: 1,
              updated_at: "2026-11-01T12:00:00Z",
            },
          ],
    }),
  );
  await page.goto(`/w/${document.projectId}/c/${document.id}`);
  await page.getByRole("button", { name: "Ask AI", exact: true }).click();
  await page.getByRole("textbox", { name: "AI prompt" }).fill("Help me start");
  await page.getByRole("textbox", { name: "AI prompt" }).press("Enter");
  const chat = page.getByRole("complementary", {
    name: "Ask about porto-trip",
  });
  await expect(chat).toContainText("Useful summary");
  await chat.getByRole("button", { name: "Past conversations" }).click();
  await chat.getByRole("button", { name: /An earlier question/ }).click();
  await expect(chat).toContainText("An earlier answer.");
  await expect(chat.getByRole("link", { name: /example.com/ })).toBeVisible();
  await chat.getByRole("button", { name: "New conversation" }).click();
  await expect(chat).not.toContainText("An earlier answer.");
  await expect(
    chat.getByRole("textbox", { name: "Follow-up question" }),
  ).toBeFocused();
});
