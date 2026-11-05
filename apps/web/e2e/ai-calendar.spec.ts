import { expect, test, type Page } from "./fixtures";

async function api(page: Page, path: string, body?: unknown, method = "POST") {
  return page.evaluate(
    async ({ path, body, method }) => {
      const csrf =
        document.cookie
          .split("; ")
          .find((item) => item.startsWith("noted_csrf="))
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

async function openPlanner(page: Page) {
  const requests: Record<string, unknown>[] = [];
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
  const activity = await api(page, "/time-tracking/activities", {
    name: "Reading",
    icon: "BookOpen",
    color: "#9db9ce",
  });
  await page.route("**/api/v1/ai/assistant", async (route) => {
    const input = route.request().postDataJSON();
    requests.push(input);
    const output = {
      explanation: "Two reading sessions.",
      habits: [],
      plans: [600, 780].map((start, index) => ({
        id: null,
        revision: null,
        scope: "series",
        occurrence_date: null,
        fields: {
          activity_id: activity.id,
          title: index ? "Read again" : "Read a chapter",
          date: input.end,
          start_minute: start,
          end_minute: start + 60,
          timezone: input.timezone,
          notifications_enabled: true,
          notification_minutes: null,
          frequency: "none",
          weekdays: [],
          repeat_until: null,
        },
      })),
    };
    await route.fulfill({
      contentType: "application/x-ndjson",
      body: JSON.stringify({ type: "done", output }) + "\n",
    });
  });
  await page.goto("/schedule");
  await page.getByRole("button", { name: "Ask AI", exact: true }).click();
  const panel = page.getByRole("complementary", {
    name: "AI assistant",
    exact: true,
  });
  await panel
    .getByRole("textbox", { name: "Message assistant" })
    .fill("Make time to read twice");
  await panel
    .getByRole("textbox", { name: "Message assistant" })
    .press("Enter");
  await expect(
    panel.getByLabel("Include Read a chapter", { exact: true }),
  ).toBeVisible();
  return { panel, requests, activity };
}

async function board(page: Page, input: Record<string, unknown>) {
  return api(
    page,
    `/schedule?${new URLSearchParams({ start: `${input.start}T00:00:00Z`, end: `${input.end}T23:59:59Z` })}`,
    undefined,
    "GET",
  );
}

test("shared calendar assistant reviews and edits suggestions before applying selected plans", async ({
  page,
}) => {
  const { panel, requests } = await openPlanner(page);
  expect((await board(page, requests[0])).plans).toHaveLength(0);
  await panel
    .getByRole("button", { name: "Read a chapter", exact: true })
    .click();
  await page.getByLabel("Title", { exact: true }).fill("Reading, edited");
  await page.getByRole("button", { name: "Keep changes", exact: true }).click();
  await panel.getByLabel("Include Read again", { exact: true }).uncheck();
  await expect(page.locator(".ai-proposal-block").first()).toBeVisible();
  await panel
    .getByRole("button", { name: "Close assistant", exact: true })
    .click();
  await page.getByRole("button", { name: "Ask AI", exact: true }).click();
  await expect(
    panel.getByLabel("Include Reading, edited", { exact: true }),
  ).toBeChecked();
  await panel
    .getByRole("button", { name: "Apply changes", exact: true })
    .click();
  await expect(panel.getByText("Applied", { exact: true })).toBeVisible();
  expect((await board(page, requests[0])).plans).toHaveLength(1);
});

test("shared calendar assistant detects new conflicts and finds a free gap", async ({
  page,
}) => {
  const { panel, requests, activity } = await openPlanner(page);
  const input = requests[0];
  await api(page, "/schedule/plans", {
    activity_id: activity.id,
    title: "Added elsewhere",
    date: input.end,
    start_minute: 600,
    end_minute: 660,
    timezone: input.timezone,
    frequency: "none",
    weekdays: [],
    repeat_until: null,
  });
  await expect(
    panel.getByText("Overlaps Added elsewhere.", { exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Apply changes", exact: true }),
  ).toBeDisabled();
  await panel.getByRole("button", { name: "Find a gap", exact: true }).click();
  await expect(
    panel.getByText("Overlaps Added elsewhere.", { exact: true }),
  ).toHaveCount(0);
  await expect(
    panel.getByRole("button", { name: "Apply changes", exact: true }),
  ).toBeEnabled();
});

test("shared calendar assistant keeps suggestions on phone without saving them", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { panel, requests } = await openPlanner(page);
  const bounds = await panel.boundingBox();
  expect(bounds!.width).toBeLessThanOrEqual(390);
  expect(bounds!.height).toBeLessThan(844 * 0.8);
  await panel
    .getByRole("button", { name: "Read a chapter", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Edit suggestion", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Keep changes", exact: true }).click();
  expect((await board(page, requests[0])).plans).toHaveLength(0);
});

test("shared assistant retries a lost apply response with the same request ID", async ({
  page,
}) => {
  const { panel, requests } = await openPlanner(page);
  await panel.getByLabel("Include Read again", { exact: true }).uncheck();
  const keys: string[] = [];
  let lost = false;
  await page.route("**/api/v1/ai/assistant/apply", async (route) => {
    keys.push(route.request().postDataJSON().request_id);
    const response = await route.fetch();
    if (!lost) {
      lost = true;
      await route.abort("connectionfailed");
    } else await route.fulfill({ response });
  });
  await panel
    .getByRole("button", { name: "Apply changes", exact: true })
    .click();
  await expect(
    panel.getByRole("button", { name: "Retry saving", exact: true }),
  ).toBeEnabled();
  await panel
    .getByRole("button", { name: "Retry saving", exact: true })
    .click();
  await expect(panel.getByText("Applied", { exact: true })).toBeVisible();
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  expect((await board(page, requests[0])).plans).toHaveLength(1);
});

test("shared assistant refinements include manual proposal edits and exclusions", async ({
  page,
}) => {
  const { panel, requests } = await openPlanner(page);
  await panel
    .getByRole("button", { name: "Read a chapter", exact: true })
    .click();
  await page.getByLabel("Title", { exact: true }).fill("My reading plan");
  await page.getByRole("button", { name: "Keep changes", exact: true }).click();
  await panel.getByLabel("Include Read again", { exact: true }).uncheck();
  await panel
    .getByRole("textbox", { name: "Message assistant" })
    .fill("Make this shorter");
  await panel
    .getByRole("textbox", { name: "Message assistant" })
    .press("Enter");
  await expect.poll(() => requests.length).toBe(2);
  const history = requests[1].history as { role: string; content: string }[];
  const prior = JSON.parse(history.at(-1)!.content);
  expect(prior.plans).toHaveLength(1);
  expect(prior.plans[0].fields.title).toBe("My reading plan");
});
