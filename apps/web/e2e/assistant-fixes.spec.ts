import { test, expect, type Page } from "./fixtures";

async function api(page: Page, path: string, body?: unknown) {
  return page.evaluate(
    async ({ path, body }) => {
      const csrf = document.cookie
        .split("; ")
        .find((item) => item.startsWith("noted_csrf="))
        ?.split("=")[1];
      const response = await fetch(`/api/v1${path}`, {
        method: body ? "POST" : "GET",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrf ?? "",
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    },
    { path, body },
  );
}

async function signIn(page: Page) {
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

test("assistant keeps drafts and reviewed posts after closing and reload, resizes, and posts only on Apply", async ({
  page,
  context,
}) => {
  await signIn(page);
  const project = await api(page, "/workspaces", { name: "Fitness" });
  const channel = await api(page, `/workspaces/${project.id}/channels`, {
    name: "0 to hero",
  });
  const proposal = {
    explanation: "Review this routine before posting.",
    habits: [],
    plans: [],
    meals: [],
    draft: "## Draft\n\n- [ ] A push-up",
    posts: [
      {
        channel_id: channel.id,
        text: "## Routine\n\n- [ ] Three sets of push-ups",
        destination: {
          channel_name: channel.name,
          workspace_name: project.name,
        },
      },
    ],
  };
  await page.route("**/api/v1/ai/assistant", (route) =>
    route.fulfill({
      contentType: "application/x-ndjson",
      body:
        JSON.stringify({
          type: "done",
          output: proposal,
          sources: [
            { url: "https://example.com/routine", title: "Routine" },
            { url: "https://example.com/routine", title: "Routine" },
          ],
        }) + "\n",
    }),
  );
  await page.goto(`/w/${project.id}/c/${channel.id}`);
  await page.getByRole("button", { name: "Ask AI", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "AI assistant" });
  const input = panel.getByRole("textbox", { name: "Message assistant" });
  await input.fill("Prepare a routine for Fitness / 0 to hero");
  await panel.getByRole("button", { name: "Send to assistant" }).click();
  await expect(panel.getByText("Post to", { exact: false })).toBeVisible();
  await expect(panel.getByText("1 source", { exact: true })).toBeVisible();
  expect(
    (await api(page, `/channels/${channel.id}/messages`)).items,
  ).toHaveLength(0);
  await input.fill("Keep this unsent question");
  const size = await panel.boundingBox();
  const handle = panel.getByRole("separator", { name: "Resize assistant" });
  await handle.focus();
  await page.keyboard.press("ArrowLeft");
  await expect
    .poll(async () => (await panel.boundingBox())!.width)
    .toBeGreaterThan(size!.width);
  await panel.getByRole("button", { name: "Close assistant" }).click();
  await page.getByRole("button", { name: "Ask AI", exact: true }).click();
  await expect(input).toHaveValue("Keep this unsent question");
  await page.reload();
  await page.getByRole("button", { name: "Ask AI", exact: true }).click();
  await expect(input).toHaveValue("Keep this unsent question");
  await expect(panel.getByText("Post to", { exact: false })).toBeVisible();
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await panel.getByRole("button", { name: "Copy draft", exact: true }).click();
  expect(
    (await page.evaluate(() => navigator.clipboard.readText())).replace(
      /\r\n/g,
      "\n",
    ),
  ).toBe(proposal.draft);
  await panel.getByRole("button", { name: "Apply changes" }).click();
  await expect(panel.getByRole("link", { name: "Open message" })).toBeVisible();
  const notes = (await api(page, `/channels/${channel.id}/messages`)).items;
  expect(notes).toHaveLength(1);
  expect(notes[0].content).toBe(proposal.posts[0].text);
  await page.screenshot({ path: "../../.local/assistant-fixes-browser.png" });
});

test("assistant streaming respects a reader scrolling upward and restores their position after closing", async ({
  page,
}) => {
  await signIn(page);
  await page.evaluate(() => {
    const original = window.fetch.bind(window);
    window.fetch = async (resource, init) => {
      if (String(resource).endsWith("/api/v1/ai/assistant")) {
        const encoder = new TextEncoder();
        return new Response(
          new ReadableStream({
            start(controller) {
              let count = 0;
              const timer = setInterval(() => {
                count++;
                controller.enqueue(
                  encoder.encode(
                    JSON.stringify({
                      type: "explanation",
                      text: Array.from(
                        { length: count * 8 },
                        (_, i) => `Paragraph ${i}: a useful explanation.\n\n`,
                      ).join(""),
                    }) + "\n",
                  ),
                );
                if (count === 15) {
                  clearInterval(timer);
                  controller.enqueue(
                    encoder.encode(
                      JSON.stringify({
                        type: "done",
                        output: {
                          explanation: "Finished",
                          habits: [],
                          plans: [],
                          meals: [],
                        },
                        sources: [],
                      }) + "\n",
                    ),
                  );
                  controller.close();
                }
              }, 400);
            },
          }),
          { headers: { "Content-Type": "application/x-ndjson" } },
        );
      }
      return original(resource, init);
    };
  });
  await page.getByRole("button", { name: "Ask AI", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "AI assistant" });
  await panel
    .getByRole("textbox", { name: "Message assistant" })
    .fill("Explain");
  await panel.getByRole("button", { name: "Send to assistant" }).click();
  const scroll = panel.locator(".shared-ai-scroll");
  await expect
    .poll(() => scroll.evaluate((el) => el.scrollHeight - el.clientHeight))
    .toBeGreaterThan(500);
  await scroll.evaluate((el) => {
    el.scrollTop = 80;
    el.dispatchEvent(new Event("scroll"));
  });
  await expect(
    panel.getByRole("button", { name: "Latest messages" }),
  ).toBeVisible();
  await page.waitForTimeout(900);
  expect(await scroll.evaluate((el) => el.scrollTop)).toBe(80);
  await panel.getByRole("button", { name: "Close assistant" }).click();
  await page.getByRole("button", { name: "Ask AI", exact: true }).click();
  expect(await scroll.evaluate((el) => el.scrollTop)).toBe(80);
  await panel.getByRole("button", { name: "Latest messages" }).click();
  await expect(
    panel.getByRole("button", { name: "Latest messages" }),
  ).not.toBeVisible();
});

test("message timestamps select notes and calendar day-off shading reaches the sidebar", async ({
  page,
}) => {
  await signIn(page);
  const project = await api(page, "/workspaces", { name: "Selection" });
  const channel = await api(page, `/workspaces/${project.id}/channels`, {
    name: "notes",
  });
  await api(page, `/channels/${channel.id}/messages`, {
    content: "Select using my timestamp",
  });
  await page.goto(`/w/${project.id}/c/${channel.id}`);
  const stamp = page.locator(".note-minute-marker").first();
  await stamp.click();
  await expect(page.locator(".note-selected")).toHaveCount(1);
  await stamp.click();
  await expect(page.locator(".note-selected")).toHaveCount(0);
  await page.goto("/schedule");
  const off = page.locator(".schedule-week-row.is-day-off").first();
  await off.scrollIntoViewIfNeeded();
  await expect(off).toBeVisible();
  await page.screenshot({ path: "../../.local/calendar-full-row.png" });
});

test("calendar deletion asks for an occurrence or series and waits for confirmation", async ({
  page,
}) => {
  await signIn(page);
  const activity = await api(page, "/time-tracking/activities", {
    name: "Reading",
  });
  const plan = await api(page, "/schedule/plans", {
    activity_id: activity.id,
    title: "Read a chapter",
    date: "2026-11-10",
    start_minute: 600,
    end_minute: 660,
    timezone: "UTC",
    frequency: "daily",
  });
  await page.route("**/api/v1/ai/assistant", (route) =>
    route.fulfill({
      contentType: "application/x-ndjson",
      body:
        JSON.stringify({
          type: "done",
          output: {
            explanation: "Choose which part of this recurring plan to remove.",
            habits: [],
            plans: [],
            meals: [],
            deletions: [
              {
                kind: "plan",
                id: plan.id,
                revision: plan.revision,
                scope: null,
                occurrence_date: null,
                target: plan,
              },
            ],
          },
          sources: [],
        }) + "\n",
    }),
  );
  await page.getByRole("button", { name: "Ask AI", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "AI assistant" });
  await panel
    .getByRole("textbox", { name: "Message assistant" })
    .fill("Delete the reading plan");
  await panel.getByRole("button", { name: "Send to assistant" }).click();
  const apply = panel.getByRole("button", { name: "Apply changes" });
  await expect(apply).toBeDisabled();
  await panel.getByRole("button", { name: "Delete recurring plan" }).click();
  await page
    .getByRole("menuitemradio", { name: "This occurrence", exact: true })
    .click();
  await apply.click();
  const dialog = page.getByRole("dialog", {
    name: "Apply changes and delete these items?",
  });
  await expect(dialog).toBeVisible();
  expect((await api(page, `/schedule/plans/${plan.id}`)).revision).toBe(
    plan.revision,
  );
  await dialog.getByRole("button", { name: "Confirm and apply" }).click();
  await expect(panel.getByText("Deleted", { exact: true })).toBeVisible();
  expect((await api(page, `/schedule/plans/${plan.id}`)).revision).toBe(
    plan.revision + 1,
  );
});
