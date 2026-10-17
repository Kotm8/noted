import { expect, test } from "@playwright/test";

test("channel menus stay beside their trigger at every supported zoom", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill("ilya");
  await page.getByLabel("Password", { exact: true }).fill("browser-test-password-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Create workspace", exact: true }).click();
  await page.getByRole("dialog").getByLabel("Name", { exact: true }).fill("Menu position");
  await page.getByRole("dialog").getByRole("button", { name: "Create workspace", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open workspace Menu position", exact: true })).toBeVisible();
  await page.locator(".workspace-title").click();
  await page.getByRole("menuitem", { name: "Create channel", exact: true }).click();
  await page.getByRole("dialog").getByLabel("Name", { exact: true }).fill("position-check");
  await page.getByRole("dialog").getByRole("button", { name: "Create channel", exact: true }).click();

  await expect(page.getByRole("heading", { name: "position-check", exact: true })).toBeVisible();
  const workspaceId = page.url().split("/w/")[1].split("/")[0];
  try {
    for (const zoom of [100, 110, 150, 75]) {
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      const slider = page.getByRole("slider", { name: "Interface zoom", exact: true });
      if (await slider.inputValue() !== String(zoom)) {
        const saved = page.waitForResponse((response) => response.url().includes("/settings/appearance") && response.request().method() === "PUT" && response.ok());
        await slider.fill(String(zoom));
        await saved;
      }
      await page.getByRole("button", { name: "Close dialog", exact: true }).click();
      const trigger = page.getByRole("button", { name: "Options for position-check", exact: true, includeHidden: true });
      await page.getByRole("button", { name: "position-check", exact: true }).hover();
      await trigger.click();
      await expect(page.getByRole("menu")).toBeVisible();
      await page.getByRole("menuitem", { name: "Edit channel", exact: true }).hover();
      await page.waitForTimeout(250);
      const anchor = (await trigger.boundingBox())!;
      const menu = (await page.getByRole("menu").boundingBox())!;
      expect(Math.min(Math.abs(menu.y - anchor.y - anchor.height), Math.abs(anchor.y - menu.y - menu.height))).toBeLessThan(18);
      expect(menu.x).toBeGreaterThanOrEqual(0);
      expect(Math.abs(menu.x + menu.width - anchor.x - anchor.width)).toBeLessThan(18);
      await page.keyboard.press("Escape");
    }
  } finally {
  await page.evaluate(async (id: string) => {
    const csrf = document.cookie.split("; ").find((value) => value.startsWith("noted_csrf="))!.split("=")[1];
    const headers = { "Content-Type": "application/json", "X-CSRF-Token": csrf };
    const response = await fetch("/api/v1/settings/appearance", {
      method: "PUT", headers, body: JSON.stringify({ zoom: 100 }),
    });
    if (!response.ok) throw new Error("Could not restore test zoom");
    const removed = await fetch(`/api/v1/workspaces/${id}`, { method: "DELETE", headers });
    if (!removed.ok) throw new Error("Could not clean up menu test workspace");
  }, workspaceId);
  }
});
