import { expect, test } from "@playwright/test";

test("skipped Android setup can be completed in settings and unlocks phone controls", async ({
  page,
}) => {
  let configured = false;
  const status = () => ({
    configured,
    subscribed: false,
    project_id: configured ? "noted-fixture" : null,
  });
  await page.route("**/api/v1/notifications/android/status*", (route) =>
    route.fulfill({ json: status() }),
  );
  await page.route("**/api/v1/notifications/android/config", (route) => {
    expect(route.request().method()).toBe("PUT");
    configured = true;
    return route.fulfill({ json: status() });
  });
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill("ilya");
  await page
    .getByLabel("Password", { exact: true })
    .fill("browser-test-password-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  await dialog
    .getByRole("button", { name: "Notifications", exact: true })
    .click();
  const android = dialog.getByRole("region", {
    name: "Android notifications",
    exact: true,
  });
  await expect(
    android.getByRole("checkbox", { name: "Send notifications to Android" }),
  ).toBeDisabled();
  await android
    .getByRole("heading", { name: "Set up Firebase" })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "../../.local/screenshots/android-settings-setup.png",
  });
  await android.getByLabel("Android app JSON", { exact: true }).fill(
    JSON.stringify({
      project_info: {
        project_id: "noted-fixture",
        project_number: "1234567890",
      },
      client: [
        {
          client_info: {
            mobilesdk_app_id: "1:1234567890:android:abcdef",
            android_client_info: { package_name: "com.noted.android" },
          },
          api_key: [{ current_key: `AIza${"a".repeat(35)}` }],
        },
      ],
    }),
  );
  await android.getByLabel("Service-account JSON", { exact: true }).fill(
    JSON.stringify({
      type: "service_account",
      project_id: "noted-fixture",
      client_email: "test@noted-fixture.iam.gserviceaccount.com",
      private_key:
        "-----BEGIN PRIVATE KEY-----\nfixture-only\n-----END PRIVATE KEY-----\n",
      token_uri: "https://oauth2.googleapis.com/token",
    }),
  );
  await android
    .getByRole("button", { name: "Save Firebase configuration" })
    .click();
  await expect(
    android.getByRole("heading", { name: "Set up Firebase" }),
  ).toHaveCount(0);
  await expect(
    android.locator(".android-project-status"),
  ).toBeVisible();
  const delivery = android.getByRole("checkbox", {
    name: "Send notifications to Android",
  });
  await expect(delivery).toBeEnabled();
  await delivery.click();
  await expect(delivery).toBeEnabled();
  await expect(delivery).not.toBeChecked();
  await delivery.click();
  await expect(delivery).toBeChecked();
  await expect(delivery).toBeEnabled();
  await page.screenshot({
    path: "../../.local/screenshots/android-settings-ready.png",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    android.locator(".android-project-status"),
  ).toBeVisible();
  await page.screenshot({
    path: "../../.local/screenshots/android-settings-mobile.png",
  });
  await android.getByRole("button", { name: "Change project" }).click();
  await expect(
    android.getByLabel("Service-account JSON", { exact: true }),
  ).toHaveValue("");
  await android.getByRole("button", { name: "Cancel changes" }).click();
  await expect(
    android.getByRole("heading", { name: "Set up Firebase" }),
  ).toHaveCount(0);
});
