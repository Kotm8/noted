import { expect, test, type Page } from "./fixtures";

const lines = (events: unknown[]) =>
  events.map((event) => JSON.stringify(event)).join("\n") + "\n";

const PROPOSAL = {
  kcal: 2260,
  protein: 165,
  carbs: 245,
  fat: 70,
  activity: "moderate",
  explanation:
    "You can't lose fat from one spot, but a steady deficit takes it from everywhere.",
  clamped: false,
  weekly_kg: -0.52,
  resting: 1825,
  maintenance: 2830,
  lowest: 2122,
  highest: 3254,
  reason: "Noted keeps targets at or above 2,122 kcal.",
  factor: 1.55,
  age: 27,
};

const ESTIMATE = {
  name: "Salmon, potatoes and salad",
  items: [
    {
      name: "Salmon fillet",
      amount: "140 g",
      kcal: 290,
      protein: 31,
      carbs: 0,
      fat: 18,
      confidence: "high",
    },
    {
      name: "Roast potatoes",
      amount: "200 g",
      kcal: 260,
      protein: 5,
      carbs: 40,
      fat: 9,
      confidence: "medium",
    },
    {
      name: "Side salad",
      amount: "1 bowl",
      kcal: 45,
      protein: 2,
      carbs: 6,
      fat: 1,
      confidence: "low",
    },
  ],
  saved_meal: null,
  question: {
    text: "How was the salad dressed?",
    choices: [
      {
        label: "Olive oil and vinegar",
        item: 2,
        kcal: 135,
        protein: 2,
        carbs: 6,
        fat: 11,
      },
      { label: "No dressing", item: 2, kcal: 45, protein: 2, carbs: 6, fat: 1 },
    ],
  },
  note: "",
};

async function signIn(page: Page) {
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
}

test("Nutrition sets a target, estimates a meal and keeps it as a saved meal", async ({
  page,
}) => {
  await signIn(page);
  let profile: Record<string, unknown> | null = null;
  await page.route("**/api/v1/ai/nutrition/target", async (route) => {
    profile = route.request().postDataJSON().profile;
    // The real endpoint saves the profile first; the mock keeps that.
    await route.fetch({
      url: route
        .request()
        .url()
        .replace("/ai/nutrition/target", "/nutrition/profile"),
      method: "PUT",
      postData: JSON.stringify(profile),
    });
    await route.fulfill({
      contentType: "application/x-ndjson",
      body: lines([
        { type: "start", run_id: null, model: "gpt-6.1-sol" },
        { type: "thinking", heading: "" },
        {
          type: "done",
          output: { ...PROPOSAL, sources: [] },
          sources: [],
          thought_seconds: 3,
        },
      ]),
    });
  });
  let estimateBody: Record<string, unknown> | null = null;
  await page.route("**/api/v1/ai/nutrition/estimate", async (route) => {
    estimateBody = route.request().postDataJSON();
    await route.fulfill({
      contentType: "application/x-ndjson",
      body: lines([
        { type: "start", run_id: null, model: "gpt-6.1-sol" },
        { type: "thinking", heading: "" },
        {
          type: "items",
          items: ESTIMATE.items.slice(0, 2),
          thought_seconds: 2,
        },
        { type: "done", output: ESTIMATE, sources: [], thought_seconds: 2 },
      ]),
    });
  });

  await page.getByRole("button", { name: "Nutrition", exact: true }).click();
  await expect(page.getByRole("heading", { name: "About you" })).toBeVisible();
  await page.getByLabel("Age").fill("27");
  await page.getByRole("radio", { name: "Male", exact: true }).click();
  await page.getByLabel("Height").fill("181");
  await page.getByLabel("Weight").fill("82.4");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("radio", { name: /Moderate/ }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await page
    .getByLabel("What do you want?")
    .fill("Lose belly fat but keep my strength");
  await page.getByRole("button", { name: "Work out my target" }).click();
  await expect(page.getByText("2,830 kcal")).toBeVisible();
  await expect(page.getByText("2,260 kcal")).toBeVisible();
  await page.screenshot({ path: "../../.local/nutrition-setup.png" });
  expect(profile).toMatchObject({ age: 27, sex: "male", activity: "moderate" });
  await page.getByRole("button", { name: "Lower Calories" }).click();
  await expect(page.getByText("2,210 kcal")).toBeVisible();
  await page.getByRole("button", { name: "Use this target" }).click();

  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
  await expect(page.locator(".ring-label")).toContainText("2,210");
  await page
    .getByLabel("Describe your meal")
    .fill("salmon, roast potatoes and a side salad");
  await page.getByLabel("Describe your meal").press("Enter");
  await expect(page.getByLabel("Meal name")).toHaveValue(
    "Salmon, potatoes and salad",
  );
  expect(estimateBody).toMatchObject({
    text: "salmon, roast potatoes and a side salad",
  });
  await expect(page.locator(".estimate-total strong")).toHaveText("595");
  await page.getByRole("button", { name: "Olive oil and vinegar" }).click();
  await expect(page.locator(".estimate-total strong")).toHaveText("685");
  await page.getByRole("button", { name: "More Roast potatoes" }).click();
  await expect(page.locator(".estimate-total strong")).toHaveText("750");
  await page.screenshot({ path: "../../.local/nutrition-estimate.png" });
  await page.getByLabel("Remember as a saved meal").check();
  await page.getByRole("button", { name: "Save meal" }).click();

  await expect(page.locator(".ring-label")).toContainText("1,460");
  const card = page
    .locator(".nutrition-meal")
    .filter({ hasText: "Salmon, potatoes and salad" });
  await expect(card).toContainText("Saved meal");
  await card.locator(".meal-head").click();
  await expect(card.getByText("125% of 200 g")).toBeVisible();
  await page.screenshot({ path: "../../.local/nutrition-today.png" });

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  await dialog
    .getByRole("button", { name: "Saved meals", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: /Salmon, potatoes and salad/ })
    .click();
  await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue(
    "Salmon, potatoes and salad",
  );
  await dialog.getByRole("button", { name: "Nutrition", exact: true }).click();
  await expect(dialog.getByText("2,210 kcal")).toBeVisible();
  await expect(dialog.getByLabel("Age")).toHaveValue("27");
  await page.screenshot({ path: "../../.local/nutrition-settings.png" });
});

test("Nutrition is hidden until AI is connected", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill("ilya");
  await page
    .getByLabel("Password", { exact: true })
    .fill("browser-test-password-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".app-shell")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Habits", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Nutrition", exact: true }),
  ).toHaveCount(0);
  await page.goto("/nutrition");
  await expect(
    page.getByRole("heading", { name: "Nutrition needs AI" }),
  ).toBeVisible();
});

test("The shared assistant can log a meal for review", async ({ page }) => {
  await signIn(page);
  await page.evaluate(async () => {
    const csrf =
      document.cookie
        .split("; ")
        .find((item) => item.startsWith("noted_csrf="))
        ?.split("=")[1] ?? "";
    const put = (path: string, body: unknown) =>
      fetch(`/api/v1${path}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify(body),
      });
    await put("/nutrition/profile", {
      age: 27,
      sex: "male",
      height_cm: 181,
      weight_kg: 82.4,
      activity: "moderate",
      goal: "",
      pace: "standard",
      pregnant: false,
      read_training: true,
    });
    await put("/nutrition/target", {
      kcal: 2260,
      protein: 165,
      carbs: 245,
      fat: 70,
    });
  });
  const today = (await (await page.request.get("/api/v1/nutrition")).json())
    .today;
  await page.route("**/api/v1/ai/assistant", (route) =>
    route.fulfill({
      contentType: "application/x-ndjson",
      body:
        JSON.stringify({
          type: "done",
          output: {
            explanation: "Logged your lunch.",
            habits: [],
            plans: [],
            meals: [
              {
                id: null,
                revision: null,
                picture: false,
                fields: {
                  day: today,
                  minute: 780,
                  slot: "Lunch",
                  name: "Chicken rice bowl",
                  items: [
                    {
                      name: "Chicken breast",
                      amount: "150 g",
                      kcal: 248,
                      protein: 46,
                      carbs: 0,
                      fat: 5,
                      confidence: "medium",
                    },
                    {
                      name: "White rice",
                      amount: "1 cup",
                      kcal: 208,
                      protein: 4,
                      carbs: 45,
                      fat: 0,
                      confidence: "medium",
                    },
                  ],
                },
              },
            ],
          },
        }) + "\n",
    }),
  );
  await page
    .locator(".sidebar-global-navigation")
    .getByRole("button", { name: "Nutrition", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
  await page.getByRole("button", { name: "Ask AI", exact: true }).click();
  const panel = page.getByRole("complementary", {
    name: "AI assistant",
    exact: true,
  });
  await panel
    .getByRole("textbox", { name: "Message assistant" })
    .fill("I had the chicken bowl for lunch");
  await panel
    .getByRole("textbox", { name: "Message assistant" })
    .press("Enter");
  await expect(panel.getByText("Log meal", { exact: true })).toBeVisible();
  await expect(panel.getByText(/456 kcal/)).toBeVisible();
  await panel
    .getByRole("button", { name: "Apply changes", exact: true })
    .click();
  await expect(panel.getByText("Applied", { exact: true })).toBeVisible();
  await expect(
    page.locator(".nutrition-meal").filter({ hasText: "Chicken rice bowl" }),
  ).toBeVisible();
  await expect(page.locator(".ring-label")).toContainText("1,804");
  await page.screenshot({ path: "../../.local/nutrition-assistant.png" });
  await panel.getByRole("button", { name: "Close assistant" }).click().catch(() => undefined);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
  await page.screenshot({ path: "../../.local/nutrition-phone.png", fullPage: true });
});
