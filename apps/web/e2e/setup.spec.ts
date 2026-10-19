import { expect, test } from "@playwright/test";

test("the desktop setup preview separates server access, Cloudflare DNS, and the owner account", async ({
  page,
}) => {
  const writes: string[] = [];
  page.on("request", (request) => {
    if (["POST", "PUT", "DELETE"].includes(request.method()))
      writes.push(request.url());
  });
  await page.goto("/setup-preview");
  await expect(
    page.getByRole("heading", { name: "Your server", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "../../.local/screenshots/setup-server-desktop.png",
    fullPage: true,
  });
  await page.getByLabel("Server name", { exact: true }).fill("My notes");
  await page.getByLabel("Server IP", { exact: true }).fill("999.0.0.1");
  await page
    .getByLabel("SSH password", { exact: true })
    .fill("preview-ssh-password");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Enter the VPS IPv4 or IPv6 address.",
  );
  await page.getByLabel("Server IP", { exact: true }).fill("203.0.113.10");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "../../.local/screenshots/setup-server-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Domain", { exact: true }).fill("notes.example.com");
  await expect(page.getByText("DNS only", { exact: true })).toBeVisible();
  await expect(
    page.getByText(/Keep DNS only for 250 MB attachments/),
  ).toBeVisible();
  await page.screenshot({
    path: "../../.local/screenshots/setup-domain-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByLabel("Email", { exact: true })).toHaveCount(0);
  await page.getByLabel("Username", { exact: true }).fill("ilya");
  await page
    .getByLabel("Password", { exact: true })
    .fill("preview-owner-password");
  await page
    .getByLabel("Confirm password", { exact: true })
    .fill("preview-other-password");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "The owner passwords do not match.",
  );
  await page
    .getByLabel("Confirm password", { exact: true })
    .fill("preview-owner-password");
  await page.screenshot({
    path: "../../.local/screenshots/setup-account-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Android notifications", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: "Configure Firebase for this server" }),
  ).not.toBeChecked();
  await page
    .getByRole("checkbox", { name: "Configure Firebase for this server" })
    .check();
  await expect(
    page.getByRole("link", { name: "Firebase console" }),
  ).toHaveAttribute("href", "https://console.firebase.google.com/");
  await page.getByRole("button", { name: "Review setup", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Import or paste google-services.json.",
  );
  await page
    .getByLabel("Android app JSON", { exact: true })
    .fill('{"project_info":{"project_id":"preview-project"}}');
  await page
    .getByLabel("Service-account JSON", { exact: true })
    .fill('{"private_key":"preview-private-key"}');
  await expect(
    page.getByLabel("Service-account JSON", { exact: true }),
  ).toHaveClass(/masked-json/);
  await page
    .getByRole("button", { name: "Show service-account JSON", exact: true })
    .click();
  await expect(
    page.getByLabel("Service-account JSON", { exact: true }),
  ).not.toHaveClass(/masked-json/);
  await page.screenshot({
    path: "../../.local/screenshots/setup-android-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "../../.local/screenshots/setup-android-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 1440, height: 960 });
  await page
    .getByRole("checkbox", { name: "Configure Firebase for this server" })
    .uncheck();
  await page
    .getByRole("checkbox", { name: "Configure Firebase for this server" })
    .check();
  await expect(
    page.getByLabel("Service-account JSON", { exact: true }),
  ).toHaveValue("");
  await page
    .getByRole("checkbox", { name: "Configure Firebase for this server" })
    .uncheck();
  await page.getByRole("button", { name: "Review setup", exact: true }).click();
  await expect(
    page.getByText("Firebase skipped", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("https://notes.example.com", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Install on server", exact: true }),
  ).toBeDisabled();
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(
    "preview-",
  );
  expect(writes).toEqual([]);
  await page.screenshot({
    path: "../../.local/screenshots/setup-review-desktop.png",
    fullPage: true,
  });
  await page.reload();
  await expect(page.getByLabel("SSH password", { exact: true })).toHaveValue(
    "",
  );
  await expect(page.getByLabel("Server name", { exact: true })).toHaveValue("");
});
