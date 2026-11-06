import { expect, test, type Page } from "./fixtures";

async function api(page: Page, path: string, body: unknown) {
  return page.evaluate(
    async ({ path, body }) => {
      const csrf =
        document.cookie
          .split("; ")
          .find((value) => value.startsWith("noted_csrf="))
          ?.split("=")[1] ?? "";
      const response = await fetch(`/api/v1${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    },
    { path, body },
  );
}

test("edits keep a history behind the toolbar and messages written offline send later", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill("ilya");
  await page
    .getByLabel("Password", { exact: true })
    .fill("browser-test-password-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".app-shell")).toBeVisible();
  const project = await api(page, "/workspaces", { name: "Writing" });
  const channel = await api(page, `/workspaces/${project.id}/channels`, {
    name: "drafts",
  });
  await page.goto(`/w/${project.id}/c/${channel.id}`);
  const composer = page.getByRole("textbox", { name: "Message drafts" });
  await composer.fill("First wording");
  await composer.press("Enter");
  const note = page.locator(".note").filter({ hasText: "First wording" });
  await expect(note).toBeVisible();

  await note.hover();
  await note.getByRole("button", { name: "Edit note" }).click();
  await page
    .getByRole("textbox", { name: "Edit note", exact: true })
    .fill("Second wording");
  await page.getByRole("button", { name: "Save changes" }).click();
  const edited = page.locator(".note").filter({ hasText: "Second wording" });
  await expect(edited).not.toContainText("edited");
  await edited.hover();
  await edited.getByRole("button", { name: "Edit history" }).click();
  const history = page.getByRole("dialog", { name: "Edit history" });
  await expect(history).toContainText("Current");
  await expect(history).toContainText("First wording");
  await history.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(
    page.locator(".note").filter({ hasText: "First wording" }),
  ).toBeVisible();

  await context.setOffline(true);
  await composer.fill("Written on the train");
  await composer.press("Enter");
  await expect(composer).toHaveValue("");
  const waiting = page.locator(".outgoing-note");
  await expect(waiting).toContainText("Written on the train");
  await expect(waiting).toContainText("Waiting to send");
  await composer.fill("And another thought");
  await composer.press("Enter");
  await expect(waiting).toHaveCount(2);

  await context.setOffline(false);
  await expect(waiting).toHaveCount(0, { timeout: 20000 });
  const sent = page.locator(".note:not(.outgoing-note)");
  await expect(sent.nth(1)).toContainText("Written on the train");
  await expect(sent.nth(2)).toContainText("And another thought");
  await page.reload();
  await expect(page.locator(".note")).toHaveCount(3);

  const firstNote = page.locator(".main-panel .note").first();
  await firstNote.hover();
  await firstNote
    .getByRole("button", { name: "Open thread", exact: true })
    .click();
  const pane = page.getByRole("complementary", { name: "Thread · #drafts" });
  const reply = pane.getByRole("textbox", { name: "Thread reply" });
  await expect(reply).toBeVisible();

  await context.setOffline(true);
  await page.getByLabel("Attach files", { exact: true }).setInputFiles({
    name: "receipt.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Paid in cash"),
  });
  await composer.fill("With a file");
  await composer.press("Enter");
  await expect(waiting).toContainText("receipt.txt");
  await reply.fill("Replied offline");
  await reply.press("Enter");
  await expect(pane.locator(".outgoing-note")).toContainText("Replied offline");

  await context.setOffline(false);
  await expect(page.locator(".outgoing-note")).toHaveCount(0, {
    timeout: 20000,
  });
  await expect(
    pane.getByText("Replied offline", { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".main-panel .note").filter({ hasText: "With a file" }),
  ).toContainText("receipt.txt");
});
