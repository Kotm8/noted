import { expect, test, type Page } from "./fixtures";

async function api(page: Page, path: string, method = "GET", body?: unknown) {
  return page.evaluate(
    async ({ path, method, body }) => {
      const csrf = document.cookie
        .split("; ")
        .find((part) => part.startsWith("noted_csrf="))!
        .slice(11);
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

test("saved foods retain photos, scale portions and keep the diary draft", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/v1/ai/status", (route) =>
    route.fulfill({
      json: { connected: true, plan: "plus", account: "fixture", usage: null },
    }),
  );
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill("ilya");
  await page
    .getByLabel("Password", { exact: true })
    .fill("browser-test-password-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".app-shell")).toBeVisible();
  await api(page, "/nutrition/profile", "PUT", {
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
  await api(page, "/nutrition/target", "PUT", {
    kcal: 2260,
    protein: 165,
    carbs: 245,
    fat: 70,
  });
  const image = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 160;
    canvas.height = 120;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#b79963";
    context.fillRect(0, 0, 160, 120);
    context.fillStyle = "#ebd6a9";
    context.beginPath();
    context.ellipse(80, 60, 58, 42, 0, 0, Math.PI * 2);
    context.fill();
    return canvas.toDataURL("image/png").split(",")[1];
  });
  const headers = {
    "X-CSRF-Token": (await page.context().cookies()).find(
      (item) => item.name === "noted_csrf",
    )!.value,
    Origin: "http://localhost:5173",
  };
  const upload = await page.request.post("/api/v1/nutrition/photos", {
    headers,
    multipart: {
      file: {
        name: "oats.png",
        mimeType: "image/png",
        buffer: Buffer.from(image, "base64"),
      },
    },
  });
  expect(upload.ok()).toBe(true);
  const photo = (await upload.json()).id;
  const item = {
    name: "Oats",
    amount: "200 g",
    grams: 200,
    kcal: 400,
    protein: 20,
    carbs: 50,
    fat: 10,
    confidence: "high",
  };
  await api(page, "/nutrition/saved-meals", "POST", {
    name: "Breakfast oats",
    items: [item],
    photo_ids: [photo],
  });
  await api(page, "/nutrition/saved-meals", "POST", {
    name: "Chicken and rice",
    items: [item, { ...item, name: "Chicken" }],
  });
  await page.goto("/nutrition");
  await page
    .getByLabel("Describe your meal", { exact: true })
    .fill("Keep this meal draft");
  await page.getByRole("tab", { name: "Saved foods", exact: true }).click();
  await expect(
    page.getByLabel("Describe your meal", { exact: true }),
  ).toBeHidden();
  await expect(page.locator(".saved-food-entry")).toHaveCount(2);
  const entry = page
    .locator(".saved-food-entry")
    .filter({ hasText: "Breakfast oats" });
  await expect(entry.getByRole("img")).toHaveAttribute(
    "src",
    `/api/v1/nutrition/photos/${photo}`,
  );
  await page
    .getByRole("button", { name: "Log Breakfast oats", exact: true })
    .click();
  await page.getByLabel("Grams", { exact: true }).fill("100");
  await expect(page.locator(".saved-food-portion-total")).toContainText(
    "200 kcal",
  );
  await page.getByRole("button", { name: "Meal slot", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Lunch", exact: true }).click();
  await page.getByRole("button", { name: "Add to diary", exact: true }).click();
  await expect(page.locator(".saved-food-portion-fields")).toHaveCount(0);
  await page.getByRole("tab", { name: "Diary", exact: true }).click();
  await expect(
    page.getByLabel("Describe your meal", { exact: true }),
  ).toHaveValue("Keep this meal draft");
  await expect(page.locator(".nutrition-meal")).toContainText("Breakfast oats");
  const state = await api(page, "/nutrition");
  const meals = await api(
    page,
    `/nutrition/meals?start=${state.today}&end=${state.today}`,
  );
  expect(meals[0].items[0].kcal).toBe(200);
  expect(meals[0].slot).toBe("Lunch");
  expect(meals[0].photo_ids).toHaveLength(1);
  await page.getByRole("tab", { name: "Saved foods", exact: true }).click();
  await page
    .getByRole("button", { name: "Edit Breakfast oats", exact: true })
    .click();
  const editor = page.getByRole("form", {
    name: "Edit Breakfast oats",
    exact: true,
  });
  await editor.getByLabel("Name", { exact: true }).fill("Morning oats");
  await page.getByRole("tab", { name: "Diary", exact: true }).click();
  const confirm = page.getByRole("dialog", {
    name: "Discard unsaved food changes?",
    exact: true,
  });
  await expect(confirm).toBeVisible();
  await confirm
    .getByRole("button", { name: "Keep editing", exact: true })
    .click();
  await editor.getByLabel("Food photo", { exact: true }).setInputFiles({
    name: "replacement.png",
    mimeType: "image/png",
    buffer: Buffer.from(image, "base64"),
  });
  await expect(
    editor.getByRole("button", { name: "Replace photo", exact: true }),
  ).toBeEnabled();
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor).toHaveCount(0);
  await page.getByRole("button", { name: "Meals", exact: true }).click();
  await expect(page.locator(".saved-food-entry")).toHaveCount(1);
  await page.getByRole("button", { name: "All", exact: true }).click();
  await page.getByLabel("Search saved foods", { exact: true }).fill("Morning");
  await expect(page.locator(".saved-food-entry")).toHaveCount(1);
  await page.getByLabel("Search saved foods", { exact: true }).fill("");
  await expect(
    page.getByText("Breakfast oats added to lunch", { exact: true }),
  ).toBeHidden();
  await page.screenshot({ path: "../../.local/saved-foods-implemented.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "../../.local/saved-foods-implemented-phone.png",
  });
  expect(errors).toEqual([]);
});
