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
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  await dialog.getByRole("button", { name: "Watch", exact: true }).click();
  await expect(
    dialog.getByRole("heading", { name: "Watch", exact: true }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Watch layout", exact: true })
    .click();
  await page
    .getByRole("menuitemradio", { name: "Above / below", exact: true })
    .click();
  await expect(
    dialog.getByText("Watch preferences saved.", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("img", {
      name: "W24 watch face preview with sample content",
    }),
  ).toBeVisible();
  await dialog
    .getByLabel("Hide task names and reminder contents on the watch face")
    .check();
  await expect(
    dialog.getByText("Watch preferences saved.", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  await dialog.getByRole("button", { name: "Watch", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "Watch layout", exact: true }),
  ).toHaveText("Above / below");
  await expect(
    dialog.getByLabel(
      "Hide task names and reminder contents on the watch face",
    ),
  ).toBeChecked();
  await expect(
    dialog.getByText("Pairing and task controls work without Firebase.", {
      exact: false,
    }),
  ).toBeVisible();
});
