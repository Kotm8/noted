import { expect, test, type Page } from "@playwright/test";

async function api(page: Page, path: string, method = "GET", body?: unknown) {
  return page.evaluate(
    async ({ path, method, body }) => {
      const csrf =
        document.cookie
          .split("; ")
          .find((value) => value.startsWith("noted_csrf="))
          ?.split("=")[1] ?? "";
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

test("Notes channels autosave Markdown, preserve drafts, and open directly from search", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill("ilya");
  await page
    .getByLabel("Password", { exact: true })
    .fill("browser-test-password-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".app-shell")).toBeVisible();
  const project = await api(page, "/workspaces", "POST", {
    name: "Writing desk",
  });
  await page.goto(`/w/${project.id}`);
  await page
    .getByRole("button", { name: "Writing desk workspace menu", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Create channel", exact: true })
    .click();
  const create = page.getByRole("dialog", {
    name: "Create channel",
    exact: true,
  });
  await create.getByLabel("Name", { exact: true }).fill("Handbook");
  await create
    .getByRole("button", { name: "Channel type", exact: true })
    .click();
  await page.getByRole("menuitemradio", { name: "Notes", exact: true }).click();
  await create
    .getByRole("button", { name: "Create channel", exact: true })
    .click();
  const note = page.getByRole("region", {
    name: "Notes document",
    exact: true,
  });
  await expect(note).toBeVisible();
  await expect(page.locator(".composer")).toHaveCount(0);
  const content =
    "# Orchard handbook\n\n**A page of my own**\n\n- [ ] Pack charger\n\n```python\nprint('hello')\n```";
  await note.getByRole("textbox", { name: "Note contents" }).fill(content);
  await expect(note.getByRole("status")).toHaveText("Saved");
  await note.getByRole("button", { name: "Preview note", exact: true }).click();
  await expect(
    note.getByRole("heading", { name: "Orchard handbook", exact: true }),
  ).toBeVisible();
  await note.getByRole("checkbox", { name: "Pack charger" }).click();
  await expect(
    note.getByRole("checkbox", { name: "Pack charger" }),
  ).toBeChecked();
  await expect(note.getByRole("status")).toHaveText("Saved");
  await page.reload();
  await expect(
    note.getByRole("checkbox", { name: "Pack charger" }),
  ).toBeChecked();
  await page.screenshot({
    path: "../../.local/screenshots/notes-document.png",
  });
  const channelId = page.url().split("/").at(-1)!;
  const saved = await api(page, `/channels/${channelId}/document`);
  await api(page, `/channels/${channelId}/document`, "PUT", {
    content: "# Orchard handbook\n\nSaved on another device.",
    revision: saved.revision,
  });
  await note.getByRole("button", { name: "Edit note", exact: true }).click();
  await note
    .getByRole("textbox", { name: "Note contents" })
    .fill("My unsaved draft");
  await expect(
    note.getByText("Your draft has been kept.", { exact: false }),
  ).toBeVisible();
  expect(
    (await api(page, `/channels/${channelId}/document`)).content,
  ).toContain("Saved on another device.");
  await note
    .getByRole("button", { name: "Load saved version", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Load saved version", exact: true })
    .getByRole("button", { name: "Load saved version", exact: true })
    .click();
  await expect(
    note.getByRole("textbox", { name: "Note contents" }),
  ).toHaveValue("# Orchard handbook\n\nSaved on another device.");
  await page.getByRole("button", { name: "Open search", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Search notes", exact: true })
    .fill("Orchard");
  await page.locator(".search-result").filter({ hasText: "Handbook" }).click();
  await expect(
    page.getByRole("complementary", { name: "Search results" }),
  ).toHaveCount(0);
  await expect(note).toBeVisible();
  await expect(page.locator(".writing-sidebar")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await note.getByRole("button", { name: "Preview note", exact: true }).click();
  await page.screenshot({
    path: "../../.local/screenshots/notes-document-mobile.png",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await api(page, `/workspaces/${project.id}`, "DELETE");
});
