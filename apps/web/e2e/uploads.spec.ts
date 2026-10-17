import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, unlink } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test("250 MB files upload and download, and larger files are rejected", async ({
  page,
}, testInfo) => {
  test.setTimeout(120000);
  const maximum = 250 * 1024 * 1024;
  const path = testInfo.outputPath("large.bin");
  const source = await open(path, "w");
  await source.truncate(maximum);
  await source.write(Buffer.from("tail"), 0, 4, maximum - 4);
  await source.close();

  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill("ilya");
  await page.getByLabel("Password", { exact: true }).fill("browser-test-password-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeVisible();
  const fixture = await page.evaluate(async () => {
    const csrf = document.cookie
      .split("; ")
      .find((value) => value.startsWith("noted_csrf="))!
      .split("=")[1];
    const create = async (path: string, body: unknown) => {
      const response = await fetch(`/api/v1${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error("Upload fixture creation failed");
      return response.json();
    };
    const workspace = await create("/workspaces", { name: "Large uploads" });
    const channel = await create(`/workspaces/${workspace.id}/channels`, { name: "files" });
    return { workspace: workspace.id, channel: channel.id };
  });

  try {
    await page.goto(`/w/${fixture.workspace}/c/${fixture.channel}`);
    await page.getByLabel("Attach files", { exact: true }).setInputFiles(path);
    await expect(page.locator(".pending-file")).toHaveCount(1);
    const uploaded = page.waitForResponse(
      (response) => response.url().endsWith("/messages/with-files") && response.status() === 201,
    );
    await page.getByRole("button", { name: "Send note", exact: true }).click();
    const message = await (await uploaded).json();
    expect(message.attachments[0].size).toBe(maximum);
    await expect(page.locator(".file-attachment")).toHaveCount(1);
    const downloaded = page.waitForEvent("download");
    await page.locator(".file-attachment").click();
    const download = await downloaded;
    expect(download.suggestedFilename()).toBe("large.bin");
    const stream = await download.createReadStream();
    const actual = createHash("sha256");
    for await (const chunk of stream) actual.update(chunk);
    const expected = createHash("sha256");
    for await (const chunk of createReadStream(path)) expected.update(chunk);
    expect(actual.digest("hex")).toBe(expected.digest("hex"));

    const oversized = await open(path, "r+");
    await oversized.truncate(maximum + 1);
    await oversized.close();
    await page.getByLabel("Attach files", { exact: true }).setInputFiles(path);
    await expect(
      page.getByText("Choose up to 10 files, 250 MB each and 500 MB total."),
    ).toBeVisible();
    await expect(page.locator(".pending-file")).toHaveCount(0);
    await expect(page.locator(".note")).toHaveCount(1);
  } finally {
    await unlink(path);
    await page.evaluate(async (workspace) => {
      const csrf = document.cookie
        .split("; ")
        .find((value) => value.startsWith("noted_csrf="))!
        .split("=")[1];
      const response = await fetch(`/api/v1/workspaces/${workspace}`, {
        method: "DELETE",
        headers: { "X-CSRF-Token": csrf },
      });
      if (!response.ok) throw new Error("Upload fixture cleanup failed");
    }, fixture.workspace);
  }
});
