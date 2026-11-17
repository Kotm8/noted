import { expect, test, type Page } from "./fixtures";

async function api(page: Page, path: string, method = "GET", body?: unknown) {
  return page.evaluate(
    async ({ path, method, body }) => {
      const csrf = document.cookie
        .split("; ")
        .find((item) => item.startsWith("noted_csrf="))
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
      return response.json();
    },
    { path, method, body },
  );
}

test("Finance uses the split layout and saves money settings and purchases", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill("ilya");
  await page
    .getByLabel("Password", { exact: true })
    .fill("browser-test-password-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".app-shell")).toBeVisible();
  await page.getByRole("button", { name: "Finance", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Finance", exact: true }),
  ).toBeVisible();
  const board = await api(page, "/finance");
  const account = board.accounts[0].id;
  const change = async (entity: string, fields: object, extra = {}) =>
    api(page, "/finance/actions", "POST", {
      request_id: crypto.randomUUID(),
      entity,
      operation: "create",
      fields,
      ...extra,
    });
  await change(
    "account",
    { opening_balance: 82000 },
    { operation: "update", id: account, revision: board.accounts[0].revision },
  );
  await change("entry", {
    account_id: account,
    kind: "income",
    amount: 160000,
    name: "Salary",
    day: board.today,
  });
  await change("entry", {
    account_id: account,
    kind: "expense",
    amount: 100520,
    name: "Monthly spending",
    category: "Other",
    day: board.today,
  });
  await change("reservation", {
    account_id: account,
    amount: 18000,
    day: board.today,
  });
  await change(
    "settings",
    { savings_value: 32000 },
    { operation: "update", revision: board.settings.revision },
  );
  await change("payment", {
    account_id: account,
    name: "Internet",
    amount: 4800,
    starts_on: board.today,
    confirm: true,
  });
  await page.reload();
  await expect(page.locator(".finance-gauge > strong")).toContainText("594.80");
  await expect(page.locator(".finance-savings")).toContainText("180");
  await expect(page.locator(".finance-upcoming")).toContainText("Internet");
  await expect(page.locator(".finance-content")).not.toContainText(
    "Until payday",
  );
  await expect(page.locator(".finance-content")).not.toContainText("Scale ±");
  await expect(page.locator(".finance-transaction-row button")).toHaveCount(0);
  await expect(page.locator(".finance-gauge g")).toHaveAttribute(
    "data-animation",
    "complete",
  );
  await page.screenshot({
    path: "../../.local/finance-implemented-desktop.png",
  });
  await page
    .locator(".finance-savings")
    .getByRole("button", { name: "Set aside", exact: true })
    .click();
  await page
    .locator(".finance-inline-form")
    .getByLabel("Amount", { exact: true })
    .fill("25.00");
  await page
    .locator(".finance-inline-form")
    .getByRole("button", { name: "Set aside", exact: true })
    .click();
  await expect(page.locator(".finance-balance-summary")).toContainText(
    "205.00",
  );
  await page
    .getByRole("button", { name: "Finance settings", exact: true })
    .click();
  await page
    .getByLabel("Profit / loss gauge maximum", { exact: true })
    .fill("2000");
  await page
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await expect(
    page.getByText("Finance settings saved", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Back to your space", exact: true })
    .click();
  await expect(
    page.getByRole("meter", { name: "Monthly profit or loss" }),
  ).toHaveAttribute("aria-valuemax", "2000");
  await page
    .getByRole("tab", { name: "Planned purchases", exact: true })
    .click();
  await page.getByRole("button", { name: "Add purchase", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Headphones");
  await page.getByLabel("Price", { exact: true }).fill("240");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Headphones", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Mark bought", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Record expense", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("tab", { name: "Tracking", exact: true }).click();
  await expect(
    page.locator(".finance-transaction-row").filter({ hasText: "Headphones" }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("heading", { name: "Finance", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "../../.local/finance-implemented-phone.png" });
  expect(errors).toEqual([]);
});
