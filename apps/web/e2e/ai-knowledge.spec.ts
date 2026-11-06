import { expect, test, type Page } from "./fixtures";

async function api(page: Page, path: string, body: unknown, method = "POST") {
  return page.evaluate(
    async ({ path, body, method }) => {
      const csrf =
        document.cookie
          .split("; ")
          .find((cookie) => cookie.startsWith("noted_csrf="))
          ?.split("=")[1] ?? "";
      const response = await fetch(`/api/v1${path}`, {
        method,
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    },
    { path, body, method },
  );
}

test("picture-only messages expose Ask AI and calendar sources open the right journal entry", async ({
  page,
  context,
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
  const project = await api(page, "/workspaces", { name: "Picture context" });
  const chat = await api(page, `/workspaces/${project.id}/channels`, {
    name: "pictures",
  });
  const journal = await api(page, `/workspaces/${project.id}/channels`, {
    name: "daily",
    kind: "journal",
  });
  let entry = await api(page, `/channels/${journal.id}/journal`, {
    title: "Quiet Tuesday",
  });
  entry = await api(
    page,
    `/journal/${entry.id}`,
    {
      title: entry.title,
      content: "Read a chapter for an hour.",
      revision: entry.revision,
    },
    "PUT",
  );
  await api(page, "/time-tracking/activities", { name: "Reading" });
  const image = await page.evaluate(async (channelId: string) => {
    const canvas = document.createElement("canvas");
    canvas.width = 300;
    canvas.height = 100;
    const drawing = canvas.getContext("2d")!;
    drawing.fillStyle = "red";
    drawing.fillRect(0, 0, 300, 100);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((blob) => resolve(blob!), "image/png"),
    );
    const form = new FormData();
    form.append("files", blob, "rectangle.png");
    const csrf =
      document.cookie
        .split("; ")
        .find((cookie) => cookie.startsWith("noted_csrf="))
        ?.split("=")[1] ?? "";
    const response = await fetch(
      `/api/v1/channels/${channelId}/messages/with-files`,
      { method: "POST", headers: { "X-CSRF-Token": csrf }, body: form },
    );
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  }, chat.id);
  await page.route("**/api/v1/ai/assistant", async (route) => {
    expect(route.request().postDataJSON().context.message_ids).toEqual([
      image.id,
    ]);
    await route.fulfill({
      contentType: "application/x-ndjson",
      body:
        [
          { type: "chat", chat_id: crypto.randomUUID() },
          { type: "explanation", text: "A red" },
          {
            type: "done",
            output: {
              explanation: "A red rectangle.",
              habits: [],
              plans: [],
              meals: [],
            },
            sources: [],
          },
        ]
          .map((event) => JSON.stringify(event))
          .join("\n") + "\n",
    });
  });
  await page.goto(`/w/${project.id}/c/${chat.id}`);
  const message = page.locator(`#note-${image.id}`);
  await message.hover();
  await message.getByRole("button", { name: "Ask AI", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "AI assistant" });
  await expect(panel.locator(".shared-ai-context")).toContainText("Picture");
  const input = panel.getByRole("textbox", { name: "Message assistant" });
  await input.fill("What is this picture?");
  await input.press("Enter");
  await expect(panel.locator(".shared-ai-turn.assistant")).toHaveText(
    "A red rectangle.",
  );
  await panel.getByRole("button", { name: "Close assistant" }).click();
  const source = {
    title: "Picture context / #daily / Quiet Tuesday",
    url: `/w/${project.id}/c/${journal.id}?entry=${entry.id}`,
    kind: "journal",
  };
  await page.route("**/api/v1/ai/calendar/runs", (route) =>
    route.fulfill({
      contentType: "application/x-ndjson",
      body:
        [
          {
            type: "start",
            run_id: null,
            kind: "answer",
            prompt_name: "Calendar",
            model: "gpt-6.1-sol",
          },
          {
            type: "search",
            query: "Quiet Tuesday",
            scope: "noted",
            action: "search",
          },
          { type: "sources", sources: [source] },
          {
            type: "done",
            output: { explanation: "Based on Quiet Tuesday.", blocks: [] },
            sources: [source],
          },
        ]
          .map((event) => JSON.stringify(event))
          .join("\n") + "\n",
    }),
  );
  await page.goto("/schedule");
  await page.getByRole("button", { name: "Ask AI", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Ask calendar AI", exact: true })
    .fill("Plan from Quiet Tuesday in my journal");
  await page
    .getByRole("textbox", { name: "Ask calendar AI", exact: true })
    .press("Enter");
  await expect(
    page.getByText("Based on Quiet Tuesday.", { exact: true }),
  ).toBeVisible();
  const link = page.getByRole("link", { name: source.title, exact: true });
  await expect(link).toHaveAttribute("href", source.url);
  const opened = context.waitForEvent("page");
  await link.click();
  const journalPage = await opened;
  await expect(journalPage.locator(".writing-sidebar")).toContainText(
    "Read a chapter for an hour.",
  );
  await journalPage.close();
});
