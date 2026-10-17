import { expect, test } from "@playwright/test";

test("portable ZIP export and previewed import preserve notes and files", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill("ilya");
  await page.getByLabel("Password", { exact: true }).fill("browser-test-password-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeVisible();
  await page.evaluate(async () => {
    const csrf = document.cookie
      .split("; ")
      .find((value) => value.startsWith("noted_csrf="))!
      .split("=")[1];
    const send = async (path: string, body: unknown) => {
      const response = await fetch(`/api/v1${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error("Fixture creation failed");
      return response.json();
    };
    const project = await send("/workspaces", { name: "Backup fixture" });
    const channel = await send(`/workspaces/${project.id}/channels`, { name: "kept" });
    const body = new FormData();
    body.set("content", "A thought that moves with me.");
    body.append("files", new File(["portable attachment"], "kept.txt", { type: "text/plain" }));
    const response = await fetch(`/api/v1/channels/${channel.id}/messages/with-files`, {
      method: "POST",
      headers: { "X-CSRF-Token": csrf },
      body,
    });
    if (!response.ok) throw new Error("Attachment fixture creation failed");
  });
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Backups", exact: true }).click();
  await page.getByRole("button", { name: "Generate backup ZIP", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download backup ZIP", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^noted-backup-.*\.zip$/);
  const path = await download.path();
  expect(path).toBeTruthy();
  await page.getByLabel("Choose backup ZIP", { exact: true }).setInputFiles(path!);
  await expect(page.getByRole("button", { name: "Import backup", exact: true })).toBeEnabled();
  await page
    .getByLabel("Replace all projects, channels, messages, and files in the app", { exact: true })
    .check();
  await expect(page.getByRole("button", { name: "Import backup", exact: true })).toBeDisabled();
  await page.getByLabel("Replace confirmation").fill("REPLACE MY NOTES ");
  await expect(page.getByRole("button", { name: "Import backup", exact: true })).toBeDisabled();
  await page.getByLabel("Add as new projects, keeping existing notes", { exact: true }).check();
  await page.screenshot({ path: "../../.local/screenshots/backups-preview.png", fullPage: true });
  await page.getByRole("button", { name: "Import backup", exact: true }).click();
  await expect(
    page.getByText("Backup imported. Your sign-in credentials are unchanged."),
  ).toBeVisible();
  const count = await page.evaluate(
    async () =>
      (await (await fetch("/api/v1/workspaces")).json()).filter(
        (item: { name: string }) => item.name === "Backup fixture",
      ).length,
  );
  expect(count).toBe(2);
  await page
    .getByLabel("Choose backup ZIP", { exact: true })
    .setInputFiles({
      name: "broken.zip",
      mimeType: "application/zip",
      buffer: Buffer.from("broken"),
    });
  await expect(page.getByRole("alert")).toContainText("valid Noted");
  await page.evaluate(async () => {
    const csrf = document.cookie
      .split("; ")
      .find((value) => value.startsWith("noted_csrf="))!
      .split("=")[1];
    const projects = await (await fetch("/api/v1/workspaces")).json();
    for (const project of projects) {
      if (project.name === "Backup fixture") {
        const response = await fetch(`/api/v1/workspaces/${project.id}`, {
          method: "DELETE",
          headers: { "X-CSRF-Token": csrf },
        });
        if (!response.ok) throw new Error("Fixture cleanup failed");
      }
    }
  });
});
