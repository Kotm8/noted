import { expect, test } from "@playwright/test";

test("watch preferences persist and show a matching preview without requiring Firebase", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill("ilya");
  await page
    .getByLabel("Password", { exact: true })
    .fill("browser-test-password-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".app-shell")).toBeVisible();
  const csrf = (await page.context().cookies()).find(
    (cookie) => cookie.name === "noted_csrf",
  )!.value;
  const reset = await page.request.put("/api/v1/wear/settings", {
    headers: {
      "X-CSRF-Token": csrf,
      Origin: new URL(page.url()).origin,
    },
    data: {
      face: "W16",
      accent: "#e2c15a",
      text_scale: 1,
      schedule_hours: 4,
      hide_contents: false,
      favorites: [],
    },
  });
  expect(reset.ok()).toBe(true);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  await dialog
    .getByRole("button", { name: "Watch appearance", exact: true })
    .click();
  await expect(
    dialog.getByRole("heading", { name: "Watch appearance", exact: true }),
  ).toBeVisible();
  await page.route("**/api/v1/wear/settings", async (route) => {
    if (route.request().method() === "PUT")
      await new Promise((resolve) => setTimeout(resolve, 350));
    await route.continue();
  });
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/wear/settings") &&
      response.request().method() === "PUT",
  );
  const privacy = dialog.getByLabel(
    "Hide task names and reminder contents on the watch face",
  );
  await privacy.check();
  await expect(privacy).toBeChecked();
  expect((await saved).ok()).toBe(true);
  await expect(
    dialog.getByText("Watch preferences saved.", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  await dialog
    .getByRole("button", { name: "Watch appearance", exact: true })
    .click();
  await expect(
    dialog.getByLabel(
      "Hide task names and reminder contents on the watch face",
    ),
  ).toBeChecked();
  await dialog.getByRole("button", { name: "Devices", exact: true }).click();
  await expect(
    dialog.getByText("Pairing and task controls work without Firebase.", {
      exact: false,
    }),
  ).toBeVisible();
});
