import { expect, test } from "./fixtures";

test("the plan card shows a placeholder and moves to the next click", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill("ilya");
  await page
    .getByLabel("Password", { exact: true })
    .fill("browser-test-password-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".app-shell")).toBeVisible();
  await page.evaluate(async () => {
    const csrf =
      document.cookie
        .split("; ")
        .find((value) => value.startsWith("noted_csrf="))
        ?.split("=")[1] ?? "";
    await fetch("/api/v1/time-tracking/activities", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: JSON.stringify({ name: "Reading" }),
    });
  });
  await page.goto("/schedule");
  const tracks = page.locator("[data-draw]");
  await tracks.nth(1).click({ position: { x: 60, y: 20 } });
  const cards = page.locator(".plan-card");
  await expect(cards).toHaveCount(1);
  const draft = page.locator("[data-draft]");
  await expect(draft).toHaveCount(1);
  await expect(draft).toContainText("Reading");
  const start = page.locator(".plan-card").getByLabel("Start", { exact: true });
  const first = await start.inputValue();
  await page.locator(".plan-card-title").fill("Chapter 4");
  await expect(draft).toContainText("Chapter 4");
  await page.screenshot({ path: "../../.local/plan-card-draft.png" });

  await tracks.nth(3).click({ position: { x: 300, y: 20 } });
  await expect(cards).toHaveCount(1);
  await expect(draft).toHaveCount(1);
  await expect(page.locator(".plan-card-title")).toHaveValue("");
  await expect(start).not.toHaveValue(first);
  await page
    .locator(".plan-card")
    .getByRole("button", { name: "Add", exact: true })
    .click();
  await expect(cards).toHaveCount(0);
  await expect(draft).toHaveCount(0);

  await tracks.nth(1).click({ position: { x: 60, y: 20 } });
  await expect(cards).toHaveCount(1);
  await page.locator(".planned-block:not(.plan-draft)").first().click();
  await expect(cards).toHaveCount(1);
  await expect(
    page.getByRole("dialog", { name: "Edit plan", exact: true }),
  ).toBeVisible();
  await expect(draft).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(cards).toHaveCount(0);
});
