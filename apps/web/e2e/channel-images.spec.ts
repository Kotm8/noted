import { expect, test } from "@playwright/test";

test("channel images display above the list and are editable only through settings", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill("ilya");
  await page.getByLabel("Password", { exact: true }).fill("browser-test-password-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Create workspace", exact: true }).click();
  await page.getByRole("dialog").getByLabel("Name", { exact: true }).fill("Channel images");
  await page.getByRole("dialog").getByRole("button", { name: "Create workspace", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Channel images workspace menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Create channel", exact: true }).click();
  await page.getByRole("dialog").getByLabel("Name", { exact: true }).fill("with-image");
  await page.getByRole("dialog").getByRole("button", { name: "Create channel", exact: true }).click();
  await expect(page.getByRole("heading", { name: "with-image", exact: true })).toBeVisible();
  await expect(page.locator(".sidebar-section-label")).toHaveCount(0);
  await page.getByRole("button", { name: "Channel options", exact: true }).click();
  await page.getByRole("menuitem", { name: "Edit channel", exact: true }).click();
  await page.getByLabel("Channel image file", { exact: true }).setInputFiles({
    name: "banner.gif",
    mimeType: "image/gif",
    buffer: Buffer.from("R0lGODlhGAAMAIEAAP8AAAAAAAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQACAAAACwAAAAAGAAMAAAIHgABCBxIsKDBgwgTKlzIsKHDhxAjSpxIsaLFiwwDAgAh+QQBEAABACwAAAAAGAAMAIEAAP8AAAAAAAAAAAAIHgABCBxIsKDBgwgTKlzIsKHDhxAjSpxIsaLFiwwDAgA7", "base64"),
  });
  await expect(page.getByAltText("Channel image preview")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Edit channel", exact: true }).click();
  const banner = page.getByAltText("with-image channel image", { exact: true });
  await expect(banner).toBeVisible();
  await expect(banner.locator("..")).not.toHaveAttribute("role", "button");
  await expect.poll(() => banner.evaluate((image: HTMLImageElement) => [image.naturalWidth, image.naturalHeight])).toEqual([512, 256]);
  await page.screenshot({ path: "../../.local/screenshots/channel-banner-desktop.png", fullPage: true });
  await page.reload();
  await expect(banner).toBeVisible();
  await page.getByRole("button", { name: "Channel images workspace menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Create channel", exact: true }).click();
  await page.getByRole("dialog").getByLabel("Name", { exact: true }).fill("without-image");
  await page.getByRole("dialog").getByRole("button", { name: "Create channel", exact: true }).click();
  await expect(page.getByRole("heading", { name: "without-image", exact: true })).toBeVisible();
  await expect(banner).toHaveCount(0);
  await page.getByRole("button", { name: "with-image", exact: true }).click();
  await expect(banner).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  await expect(banner).toBeVisible();
  await page.screenshot({ path: "../../.local/screenshots/channel-banner-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "Close navigation", exact: true }).click({ position: { x: 370, y: 400 } });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.getByRole("button", { name: "Channel options", exact: true }).click();
  await page.getByRole("menuitem", { name: "Edit channel", exact: true }).click();
  await page.getByRole("button", { name: "Remove image", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Edit channel", exact: true }).click();
  await expect(banner).toHaveCount(0);
});
