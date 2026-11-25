import { expect, test, type Page } from "./fixtures";

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

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill("ilya");
  await page
    .getByLabel("Password", { exact: true })
    .fill("browser-test-password-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".home-b")).toBeVisible();
}

test("Home B shares real tracking, habit progress, pins and reminder creation with other pages", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await signIn(page);
  const tracker = await api(page, "/time-tracking/tracker");
  const today = new Date(tracker.server_time).toISOString().slice(0, 10);
  const project = await api(page, "/workspaces", "POST", { name: "Personal" });
  const notes = await api(page, `/workspaces/${project.id}/channels`, "POST", {
    name: "little-thoughts",
  });
  const journal = await api(
    page,
    `/workspaces/${project.id}/channels`,
    "POST",
    { name: "journal", kind: "journal" },
  );
  await api(page, `/channels/${notes.id}/pin`, "PUT", { pinned: true });
  await api(page, `/channels/${journal.id}/pin`, "PUT", { pinned: true });
  await api(page, `/channels/${notes.id}/messages`, "POST", {
    content: "Take a walk before the next call",
  });
  const work = await api(page, "/time-tracking/activities", "POST", {
    name: "Working",
    color: "#e2c15a",
    icon: "BriefcaseBusiness",
  });
  const study = await api(page, "/time-tracking/activities", "POST", {
    name: "Studying",
    color: "#9db9ce",
    icon: "BookOpen",
  });
  const reading = await api(page, "/habits", "POST", {
    name: "A little reading",
    starts_on: today,
    kind: "check",
    timezone: "UTC",
  });
  const water = await api(page, "/habits", "POST", {
    name: "Drink water",
    starts_on: today,
    kind: "count",
    goal: 8,
    unit: "glasses",
    timezone: "UTC",
  });
  await api(page, "/time-tracking/preferences", "PUT", {
    ...tracker.preferences,
    timezone: "UTC",
    start_minute: 480,
    end_minute: 1320,
    revision: tracker.revision,
  });
  const updated = await api(page, "/time-tracking/tracker");
  await api(page, "/time-tracking/tracker", "POST", {
    action: "start",
    activity_id: work.id,
    revision: updated.revision,
    request_id: crypto.randomUUID(),
  });
  for (const [offset, activity, title] of [
    [0, work, "Working"],
    [1, study, "Studying"],
    [2, study, "Long walk"],
  ] as const) {
    const date = new Date(`${today}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + offset);
    await api(page, "/schedule/plans", "POST", {
      activity_id: activity.id,
      title,
      date: date.toISOString().slice(0, 10),
      start_minute: offset ? 600 : 540,
      end_minute: offset ? 720 : 660,
      timezone: "UTC",
      notifications_enabled: false,
    });
  }
  await page.reload();
  const header = page.locator(".home-b-header");
  await expect(header).toContainText("Working");
  await header.getByRole("button", { name: "Pause activity" }).click();
  await expect(
    header.getByRole("button", { name: "Resume activity" }),
  ).toBeVisible();
  const elapsed = await header.locator("time").innerText();
  await page.waitForTimeout(1100);
  await expect(header.locator("time")).toHaveText(elapsed);
  await header.getByRole("button", { name: "Resume activity" }).click();
  await expect(
    header.getByRole("button", { name: "Pause activity" }),
  ).toBeVisible();
  await header.getByRole("button", { name: "Switch", exact: true }).click();
  await page
    .locator(".tracker-activities")
    .getByRole("button", { name: "Studying", exact: true })
    .click();
  await expect(header).toContainText("Studying");
  await header.getByRole("button", { name: "Stop activity" }).click();
  await expect(
    header.getByRole("button", { name: "Start tracking", exact: true }),
  ).toBeVisible();
  const habits = page.getByRole("region", { name: "Today's habits" });
  await habits.getByRole("checkbox", { name: reading.name }).click();
  await expect(
    habits.getByRole("checkbox", { name: reading.name }),
  ).toHaveAttribute("aria-checked", "true");
  await habits.getByRole("button", { name: `Increase ${water.name}` }).click();
  await expect(
    habits.locator(".home-habit-count").filter({ hasText: "1/8" }),
  ).toBeVisible();
  await habits.getByRole("button", { name: `Decrease ${water.name}` }).click();
  await expect(
    habits.locator(".home-habit-count").filter({ hasText: "0/8" }),
  ).toBeVisible();
  await expect(page.locator(".home-b-pins")).toContainText(
    "Take a walk before the next call",
  );
  await page
    .getByRole("region", { name: "Needs you", exact: true })
    .getByRole("button", { name: "Reminder", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Reminder text" })
    .fill("Call the bank about the card");
  await page.getByRole("button", { name: "Choose time" }).click();
  await page.getByRole("button", { name: "Send reminder" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Needs you", exact: true }),
  ).toContainText("Call the bank about the card");
  await page.getByRole("button", { name: "New entry in journal" }).click();
  await page
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Home journal entry");
  await page.getByRole("button", { name: "Create entry", exact: true }).click();
  await expect(
    page.getByRole("complementary", { name: "Journal entry", exact: true }),
  ).toBeVisible();
  await expect
    .poll(
      async () =>
        (await api(page, `/channels/${journal.id}/journal`))[0]?.title,
    )
    .toBe("Home journal entry");
  await page.goto("/home");
  const tomorrow = new Date(`${today}T12:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const nextDay = tomorrow.toISOString().slice(0, 10);
  await page
    .getByRole("button", { name: `Open calendar for ${nextDay}` })
    .click();
  await expect(page).toHaveURL(new RegExp(`date=${nextDay}`));
  await expect(page.locator(".schedule-grid")).toContainText("Studying");
  await page.goto("/schedule?date=2026-99-99");
  await expect(page.locator(".schedule-grid")).toBeVisible();
  expect(errors).toEqual([]);
});

test("Home sidebar keeps the selected project's channels and cross-project pins after returning Home", async ({
  page,
}) => {
  await signIn(page);
  const first = await api(page, "/workspaces", "POST", { name: "Personal" });
  const second = await api(page, "/workspaces", "POST", { name: "Work" });
  const firstChannel = await api(
    page,
    `/workspaces/${first.id}/channels`,
    "POST",
    { name: "thoughts" },
  );
  const category = await api(
    page,
    `/workspaces/${second.id}/categories`,
    "POST",
    { name: "Writing" },
  );
  const secondChannel = await api(
    page,
    `/workspaces/${second.id}/channels`,
    "POST",
    { name: "work-notes", category_id: category.id },
  );
  await api(page, `/channels/${firstChannel.id}/pin`, "PUT", { pinned: true });
  await page.goto(`/w/${second.id}/c/${secondChannel.id}`);
  await expect(
    page.getByRole("heading", { name: "work-notes", exact: true }),
  ).toBeVisible();
  const sidebar = page.getByRole("complementary", {
    name: "Channels",
    exact: true,
  });
  await sidebar.getByRole("button", { name: "Home", exact: true }).click();
  await expect(page.locator(".home-b")).toBeVisible();
  await expect(
    sidebar.getByRole("button", { name: "Work workspace menu", exact: true }),
  ).toBeVisible();
  await expect(sidebar.locator(".category-toggle")).toHaveText(["Writing"]);
  await expect(sidebar.locator(".channel-link")).toHaveText(["work-notes"]);
  const rail = page.getByRole("navigation", {
    name: "Workspaces",
    exact: true,
  });
  const workButton = rail.getByRole("button", {
    name: "Open workspace Work",
    exact: true,
  });
  await expect(workButton.locator(".workspace-name")).toHaveText("Work");
  await expect(
    rail
      .getByRole("button", { name: "Create workspace", exact: true })
      .locator(".workspace-name"),
  ).toHaveText("New");
  const iconBounds = await workButton.locator(".workspace-icon").boundingBox();
  const labelBounds = await workButton.locator(".workspace-name").boundingBox();
  expect(labelBounds!.y).toBeGreaterThanOrEqual(
    iconBounds!.y + iconBounds!.height,
  );
  expect((await rail.boundingBox())!.width).toBe(76);
  await page
    .locator(".app-shell")
    .screenshot({ path: "../../.local/home-b-rail-and-sidebar.png" });
  await expect(sidebar.locator(".home-project-navigation")).toHaveCount(0);
  await expect(sidebar.getByText("Your space", { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(
    sidebar.getByRole("button", { name: "Work workspace menu", exact: true }),
  ).toBeVisible();
  await sidebar
    .locator(".sidebar-pins")
    .getByRole("button", { name: /thoughts/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "thoughts", exact: true }),
  ).toBeVisible();
  await sidebar.getByRole("button", { name: "Home", exact: true }).click();
  await expect(
    sidebar.getByRole("button", {
      name: "Personal workspace menu",
      exact: true,
    }),
  ).toBeVisible();
  await expect(sidebar.locator(".channel-link")).toHaveText(["thoughts"]);
  await page
    .getByRole("navigation", { name: "Workspaces", exact: true })
    .getByRole("button", { name: "Open workspace Work", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "work-notes", exact: true }),
  ).toBeVisible();
});

test("Home B matches the chosen two-row layout with real data and responsive controls", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1232, height: 780 });
  await signIn(page);
  const tracker = await api(page, "/time-tracking/tracker");
  const today = new Date(tracker.server_time).toISOString().slice(0, 10);
  await page.route("**/api/v1/ai/status", (route) =>
    route.fulfill({ json: { connected: true } }),
  );
  await page.route("**/api/v1/nutrition", (route) =>
    route.fulfill({
      json: {
        today,
        timezone: "UTC",
        profile: {},
        target: { kcal: 2300, protein: 140, carbs: 260, fat: 75 },
        saved_meals: [],
        weigh_ins: [],
        limits: null,
      },
    }),
  );
  const meal = {
    id: "preview-meal",
    day: today,
    minute: 500,
    slot: "Breakfast",
    name: "Oats, banana and coffee",
    photo_ids: [],
    items: [{ name: "Breakfast", kcal: 520, protein: 20, carbs: 80, fat: 13 }],
    revision: 1,
  };
  await page.route("**/api/v1/nutrition/meals?**", (route) =>
    route.fulfill({ json: [meal] }),
  );
  await page.route("**/api/v1/nutrition/days?**", (route) =>
    route.fulfill({ json: [{ day: today, kcal: 2104 }] }),
  );
  const project = await api(page, "/workspaces", "POST", { name: "Personal" });
  const channel = await api(
    page,
    `/workspaces/${project.id}/channels`,
    "POST",
    { name: "little-thoughts" },
  );
  await api(page, `/channels/${channel.id}/pin`, "PUT", { pinned: true });
  await api(page, `/channels/${channel.id}/messages`, "POST", {
    content: "Take a walk before the next call",
  });
  const activity = await api(page, "/time-tracking/activities", "POST", {
    name: "Working",
    icon: "BriefcaseBusiness",
    color: "#e2c15a",
  });
  const studying = await api(page, "/time-tracking/activities", "POST", {
    name: "Studying",
    icon: "BookOpen",
    color: "#9db9ce",
  });
  const walking = await api(page, "/time-tracking/activities", "POST", {
    name: "Walking",
    icon: "Trees",
    color: "#9fc28a",
  });
  await api(page, "/time-tracking/tracker", "POST", {
    action: "start",
    revision: tracker.revision,
    activity_id: activity.id,
    request_id: crypto.randomUUID(),
  });
  await api(page, "/habits", "POST", {
    name: "A little reading",
    starts_on: today,
    timezone: "UTC",
  });
  await api(page, "/habits", "POST", {
    name: "Drink water",
    kind: "count",
    goal: 8,
    starts_on: today,
    timezone: "UTC",
  });
  await api(page, "/habits", "POST", {
    name: "No phone after 23:00",
    starts_on: today,
    timezone: "UTC",
  });
  for (const [index, content] of [
    "Call the bank about the card",
    "Pick up the parcel",
  ].entries())
    await api(page, `/channels/${channel.id}/messages`, "POST", {
      content,
      reminder: {
        due_at: new Date(Date.now() + (index + 1) * 3600000).toISOString(),
      },
    });
  for (let offset = 0; offset < 3; offset++) {
    const date = new Date(`${today}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + offset);
    await api(page, "/schedule/plans", "POST", {
      activity_id: offset === 2 ? walking.id : studying.id,
      title:
        offset === 2 ? "Long walk" : offset ? "Studying" : "Make room to learn",
      date: date.toISOString().slice(0, 10),
      start_minute: offset ? 600 : 840,
      end_minute: offset ? 720 : 900,
      timezone: "UTC",
      notifications_enabled: false,
    });
  }
  await page.reload();
  await expect(page.locator(".home-b-food")).toContainText(meal.name);
  await expect(page.locator(".home-ruler-day")).toHaveCount(3);
  const needs = await page.locator(".home-b-needs").boundingBox();
  const habits = await page.locator(".home-b-habits").boundingBox();
  const food = await page.locator(".home-b-food").boundingBox();
  const pins = await page.locator(".home-b-pins").boundingBox();
  expect(Math.abs(needs!.y - habits!.y)).toBeLessThan(1);
  expect(Math.abs(food!.y - pins!.y)).toBeLessThan(1);
  expect(habits!.x).toBeGreaterThan(needs!.x);
  await page
    .locator(".home-b")
    .screenshot({ path: "../../.local/home-b-built.png" });
  await page.getByRole("button", { name: "Log meal", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Log meal", exact: true }),
  ).toBeVisible();
  const mealDialog = page.getByRole("dialog", {
    name: "Log meal",
    exact: true,
  });
  const description = mealDialog.getByRole("textbox", {
    name: "Describe your meal",
  });
  await description.fill("Coffee with milk");
  await page.mouse.click(5, 5);
  const confirmation = page.getByRole("dialog", { name: "Discard this meal?" });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "Keep editing" }).click();
  await expect(description).toHaveValue("Coffee with milk");
  await page.route("**/api/v1/ai/nutrition/estimate", (route) =>
    route.fulfill({
      contentType: "application/x-ndjson",
      body:
        JSON.stringify({
          type: "done",
          thought_seconds: 10,
          sources: [],
          output: {
            name: "Coffee with milk",
            items: [
              {
                name: "Coffee with milk",
                amount: "1 cup, about 30 mL milk",
                kcal: 17,
                protein: 1,
                carbs: 1,
                fat: 1,
                confidence: "low",
              },
            ],
            saved_meal: null,
            note: "Based on your recent coffee logs.",
          },
        }) + "\n",
    }),
  );
  await mealDialog.getByRole("button", { name: "Estimate" }).click();
  await expect(
    mealDialog.getByRole("button", { name: "Save meal" }),
  ).toBeVisible();
  const fits = () =>
    mealDialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1);
  expect(await fits()).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await fits()).toBe(true);
  await mealDialog.getByRole("button", { name: "Close dialog" }).click();
  await confirmation.getByRole("button", { name: "Discard meal" }).click();
  await expect(mealDialog).toHaveCount(0);
  await expect(page.locator(".home-b-food")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .locator(".home-b")
    .screenshot({ path: "../../.local/home-b-mobile.png" });
});
