import { clientVersion, expect, test, type Page } from "./fixtures";

test("thread attachments support picker, paste and queued file retries", async ({
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
    name: "Thread files",
  });
  const channel = await api(
    page,
    `/workspaces/${project.id}/channels`,
    "POST",
    { name: "media" },
  );
  const root = await api(page, `/channels/${channel.id}/messages`, "POST", {
    content: "Root message",
  });
  await page.goto(`/w/${project.id}/c/${channel.id}`);
  const rootNote = page.locator(`#note-${root.id}`);
  await rootNote.hover();
  await rootNote
    .getByRole("button", { name: "Reply in thread", exact: true })
    .click();
  const thread = page.locator(".writing-sidebar");
  const input = thread.getByRole("textbox", { name: "Thread reply" });
  await expect(input).toHaveAttribute("placeholder", "Reply in thread");
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 24;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "red";
    context.fillRect(0, 0, 32, 24);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await thread.getByLabel("Attach reply files").setInputFiles({
    name: "thread.png",
    mimeType: "image/png",
    buffer: Buffer.from(png, "base64"),
  });
  await input.fill("Picture reply");
  await input.press("Enter");
  const picture = thread.locator(".note").filter({ hasText: "Picture reply" });
  await expect(picture.locator(".image-attachment")).toBeVisible();
  await expect(picture.locator("img")).toBeVisible();
  await page.screenshot({
    path: `../../.local/release-${clientVersion}/thread-media.png`,
  });
  await input.evaluate((element) => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File(["Pasted reply file"], "pasted.txt", { type: "text/plain" }),
    );
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: transfer,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect(thread.locator(".pending-file")).toContainText("pasted.txt");
  await thread.getByRole("button", { name: "Send reply" }).click();
  await expect(thread.locator(".file-attachment")).toContainText("pasted.txt");
  await thread.locator(".thread-composer").evaluate((element) => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File(["Dropped bytes"], "dropped.txt", { type: "text/plain" }),
    );
    element.dispatchEvent(
      new DragEvent("drop", {
        dataTransfer: transfer,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await thread.getByRole("button", { name: "Send reply" }).click();
  await expect(
    thread.locator(".file-attachment").filter({ hasText: "dropped.txt" }),
  ).toBeVisible();
  const endpoint = `**/messages/${root.id}/thread/with-files`;
  await page.route(endpoint, (route) => route.abort());
  await thread.getByLabel("Attach reply files").setInputFiles({
    name: "queued.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Queued bytes"),
  });
  await input.fill("Queued attachment");
  await input.press("Enter");
  await expect(thread.locator(".outgoing-note")).toContainText(
    "Queued attachment",
  );
  await page.unroute(endpoint);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(
    thread.locator(".note").filter({ hasText: "Queued attachment" }),
  ).toHaveCount(1);
  const saved = await api(page, `/messages/${root.id}/thread`);
  expect(saved.replies.items).toHaveLength(4);
  expect(saved.replies.items[3].attachments[0].original_filename).toBe(
    "queued.txt",
  );
});

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

test("checkboxes, T01 threads, and J01 journal entries persist without losing drafts", async ({
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
  await api(page, "/settings/appearance", "PUT", {
    zoom: 100,
    messageLayout: "minute",
  });
  const project = await api(page, "/workspaces", "POST", {
    name: "Writing study",
  });
  const channel = await api(
    page,
    `/workspaces/${project.id}/channels`,
    "POST",
    { name: "thoughts" },
  );
  for (let index = 0; index < 22; index++)
    await api(page, "/workspaces", "POST", {
      name: `Background project ${index + 1}`,
    });
  await page.goto(`/w/${project.id}/c/${channel.id}`);
  const composer = page.getByRole("textbox", {
    name: "Message thoughts",
    exact: true,
  });
  await composer.fill("- [ ] Pack charger\n- [x] Bring notebook");
  await composer.press("Control+Enter");
  const checkboxSaved = page.waitForResponse(
    (response) =>
      response.url().includes("/messages/") &&
      response.request().method() === "PUT" &&
      response.status() === 200,
  );
  await page.getByRole("checkbox", { name: "Pack charger" }).check();
  await checkboxSaved;
  await expect(
    page.getByRole("checkbox", { name: "Pack charger" }),
  ).toBeChecked();
  await page.reload();
  await expect(
    page.getByRole("checkbox", { name: "Pack charger" }),
  ).toBeChecked();
  await page.locator(".main-panel .note").hover();
  await page
    .getByRole("button", { name: "Reply in thread", exact: true })
    .click();
  const pane = page.getByRole("complementary", { name: "Thread · #thoughts" });
  await expect(pane).toBeVisible();
  await expect(pane.getByText("Replies stay in this thread")).toHaveCount(0);
  await expect(pane.getByText("Enter to reply")).toHaveCount(0);
  await pane
    .getByRole("textbox", { name: "Thread reply" })
    .fill("- [ ] Child task");
  await pane
    .getByRole("textbox", { name: "Thread reply" })
    .press("Control+Enter");
  await expect(
    pane.getByRole("checkbox", { name: "Child task" }),
  ).toBeVisible();
  await pane.getByRole("checkbox", { name: "Child task" }).check();
  await expect(
    pane.getByRole("checkbox", { name: "Child task" }),
  ).toBeChecked();
  await expect(page.locator(".main-panel .note")).toHaveCount(1);
  await pane
    .getByRole("textbox", { name: "Thread reply" })
    .fill("Keep this reply draft");
  await pane.getByRole("button", { name: "Close sidebar" }).click();
  await page.getByRole("button", { name: /^1 reply/ }).click();
  await expect(pane.getByRole("textbox", { name: "Thread reply" })).toHaveValue(
    "Keep this reply draft",
  );
  const initialWidth = (await pane.boundingBox())!.width;
  const handle = await pane.getByRole("separator").boundingBox();
  await page.mouse.move(handle!.x + 4, handle!.y + 150);
  await page.mouse.down();
  await page.mouse.move(handle!.x - 75, handle!.y + 150, { steps: 6 });
  await page.mouse.up();
  expect((await pane.boundingBox())!.width).toBeGreaterThan(initialWidth + 55);
  await page.screenshot({ path: "../../.local/threads-app.png" });
  await pane.getByRole("button", { name: "Close sidebar" }).click();
  await page.keyboard.press("Control+k");
  await page
    .getByRole("textbox", { name: "Search notes", exact: true })
    .fill("Child task");
  await page
    .locator(".search-result")
    .filter({ hasText: "Child task" })
    .click();
  await expect(
    pane.getByRole("checkbox", { name: "Child task" }),
  ).toBeChecked();
  await expect(pane.locator('[data-highlighted="true"]')).toBeVisible();
  await pane.getByRole("button", { name: "Back to latest replies" }).click();
  await pane.getByRole("button", { name: "Close sidebar" }).click();
  await page.locator(".workspace-title").click();
  await page
    .getByRole("menuitem", { name: "Create channel", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("Name", { exact: true })
    .fill("Daily journal");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Channel type", exact: true })
    .click();
  await page
    .getByRole("menuitemradio", { name: "Journal", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create channel", exact: true })
    .click();
  await page
    .locator(".journal-entries")
    .click({ position: { x: 300, y: 200 } });
  await page.getByRole("dialog").getByLabel("Entry name").fill("Sunday notes");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create entry", exact: true })
    .click();
  const journal = page.getByRole("complementary", {
    name: "Journal entry",
    exact: true,
  });
  await journal
    .getByRole("textbox", { name: "Entry contents" })
    .fill("- [ ] Read chapter\n- [x] Make coffee\n\n**A page of my own**");
  await journal.getByRole("button", { name: "Preview entry" }).click();
  await journal.getByRole("checkbox", { name: "Read chapter" }).check();
  await expect(journal.getByRole("status")).toHaveText("Saved");
  await journal.getByRole("button", { name: "Close sidebar" }).click();
  await page.reload();
  await page.getByRole("button", { name: "Sunday notes" }).click();
  await expect(
    journal.getByRole("checkbox", { name: "Read chapter" }),
  ).toBeChecked();
  await expect(journal.locator("strong")).toHaveText("A page of my own");
  await page.screenshot({ path: "../../.local/journal-app.png" });
  const journalChannel = (
    await api(page, `/workspaces/${project.id}/channels`)
  ).find((item: { kind: string }) => item.kind === "journal");
  const summary = (
    await api(page, `/channels/${journalChannel.id}/journal`)
  )[0];
  const saved = await api(page, `/journal/${summary.id}`);
  await journal
    .getByRole("button", { name: "Edit entry", exact: true })
    .click();
  await journal
    .getByRole("textbox", { name: "Entry contents" })
    .fill("Keep my unsaved writing");
  await api(page, `/journal/${summary.id}`, "PUT", {
    title: saved.title,
    content: "Edited on another device",
    revision: saved.revision,
  });
  await expect(
    journal.getByRole("textbox", { name: "Entry contents" }),
  ).toHaveValue("Keep my unsaved writing");
  await expect(
    journal.getByText("Your draft has been kept.", { exact: false }),
  ).toBeVisible();
  expect((await api(page, `/journal/${summary.id}`)).content).toBe(
    "Edited on another device",
  );
  await journal
    .getByRole("button", { name: "Load saved version", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Load saved version", exact: true })
    .click();
  await expect(
    journal.getByRole("textbox", { name: "Entry contents" }),
  ).toHaveValue("Edited on another device");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(async () => (await journal.boundingBox())!.width)
    .toBeGreaterThan(385);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "../../.local/journal-app-mobile.png" });
  await journal.getByRole("button", { name: "Close sidebar" }).click();
  await expect(journal).toHaveCount(0);
  expect(errors).toEqual([]);
});
