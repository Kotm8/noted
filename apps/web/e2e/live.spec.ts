import { expect, test, type Page } from "./fixtures";

async function api(page: Page, path: string, body: unknown) {
  return page.evaluate(
    async ({ path, body }) => {
      const csrf =
        document.cookie
          .split("; ")
          .find((cookie) => cookie.startsWith("noted_csrf="))
          ?.split("=")[1] ?? "";
      const response = await fetch(`/api/v1${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": decodeURIComponent(csrf),
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    },
    { path, body },
  );
}

function hello(page: Page) {
  return page
    .waitForEvent("websocket", {
      predicate: (socket) => socket.url().endsWith("/api/v1/live"),
    })
    .then((socket) =>
      socket.waitForEvent("framereceived", {
        predicate: (event) => String(event.payload).includes('"type":"hello"'),
      }),
    );
}

test("two signed-in windows receive messages immediately over the live socket", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill("ilya");
  await page
    .getByLabel("Password", { exact: true })
    .fill("browser-test-password-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Create workspace", exact: true }),
  ).toBeVisible();
  const workspace = await api(page, "/workspaces", { name: "Live project" });
  const channel = await api(page, `/workspaces/${workspace.id}/channels`, {
    name: "live-notes",
  });
  await page.goto(`/w/${workspace.id}/c/${channel.id}`);
  await expect(
    page.getByRole("textbox", { name: "Message live-notes" }),
  ).toBeVisible();
  const other = await context.newPage();
  const ready = hello(other);
  await other.goto(`/w/${workspace.id}/c/${channel.id}`);
  await ready;
  await expect(
    other.getByRole("textbox", { name: "Message live-notes" }),
  ).toBeVisible();
  const reads: number[] = [];
  other.on("request", (request) => {
    if (
      request.url().includes(`/channels/${channel.id}/messages`) &&
      request.method() === "GET"
    )
      reads.push(Date.now());
  });
  const started = Date.now();
  await page
    .getByRole("textbox", { name: "Message live-notes" })
    .fill("Across windows instantly");
  await page
    .getByRole("textbox", { name: "Message live-notes" })
    .press("Enter");
  await expect(
    other.getByText("Across windows instantly", { exact: true }),
  ).toBeVisible({ timeout: 2000 });
  expect(Date.now() - started).toBeLessThan(2000);
  expect(reads.length).toBeGreaterThan(0);
  await other.routeWebSocket("**/api/v1/live", (socket) => socket.close());
  await other.reload();
  await expect(
    other.getByText("Across windows instantly", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Message live-notes" })
    .fill("Polling still works");
  await page
    .getByRole("textbox", { name: "Message live-notes" })
    .press("Enter");
  await expect(
    other.getByText("Polling still works", { exact: true }),
  ).toBeVisible({ timeout: 18000 });
  await other.close();
});
