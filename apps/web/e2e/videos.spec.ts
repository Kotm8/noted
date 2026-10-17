import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

test("videos play inline, seek, pause other clips, and recover from a failed request", async ({
  page,
}) => {
  test.setTimeout(90000);
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
      if (!response.ok) throw new Error("Video fixture creation failed");
      return response.json();
    };
    const workspace = await create("/workspaces", { name: "Video notes" });
    const channel = await create(`/workspaces/${workspace.id}/channels`, { name: "clips" });
    return { workspace: workspace.id, channel: channel.id };
  });

  try {
    await page.goto(`/w/${fixture.workspace}/c/${fixture.channel}`);
    await page
      .getByLabel("Attach files", { exact: true })
      .setInputFiles([
        resolve(import.meta.dirname, "../../../backend/tests/fixtures/video.mp4"),
        resolve(import.meta.dirname, "../../../backend/tests/fixtures/video.webm"),
      ]);
    const uploaded = page.waitForResponse(
      (response) => response.url().endsWith("/messages/with-files") && response.status() === 201,
    );
    await page.getByRole("button", { name: "Send note", exact: true }).click();
    const note = await (await uploaded).json();
    const cards = page.locator(".video-attachment");
    await expect(cards).toHaveCount(2);
    const first = cards.nth(0).locator("video");
    const second = cards.nth(1).locator("video");
    await expect
      .poll(() => first.evaluate((video: HTMLVideoElement) => video.readyState))
      .toBeGreaterThanOrEqual(2);
    await expect
      .poll(() => second.evaluate((video: HTMLVideoElement) => video.readyState))
      .toBeGreaterThanOrEqual(2);
    expect(await first.evaluate((video: HTMLVideoElement) => video.duration)).toBeCloseTo(5, 0);
    await expect(first).toHaveAttribute("playsinline", "");
    await expect(first).toHaveAttribute("preload", "metadata");
    await expect(first).toHaveJSProperty("paused", true);
    await expect(first).toHaveJSProperty("controls", true);
    await page.screenshot({ path: "../../.local/screenshots/videos-desktop.png", fullPage: true });

    await first.evaluate((video: HTMLVideoElement) => {
      video.muted = true;
      video.loop = true;
    });
    await second.evaluate((video: HTMLVideoElement) => {
      video.muted = true;
      video.loop = true;
    });
    await page.getByRole("button", { name: "Play video.mp4", exact: true }).click();
    await expect
      .poll(() => first.evaluate((video: HTMLVideoElement) => video.currentTime))
      .toBeGreaterThan(0.1);
    await expect(first).toHaveJSProperty("paused", false);
    await first.evaluate((video: HTMLVideoElement) => {
      video.pause();
      video.currentTime = 3;
    });
    await expect
      .poll(() =>
        first.evaluate((video: HTMLVideoElement) => !video.seeking && video.readyState >= 2),
      )
      .toBe(true);
    expect(await first.evaluate((video: HTMLVideoElement) => video.currentTime)).toBeCloseTo(3, 1);
    const range = await page.request.get(note.attachments[0].playback_url, {
      headers: { Range: "bytes=-16" },
    });
    expect(range.status()).toBe(206);
    expect((await range.body()).length).toBe(16);
    expect(range.headers()["content-range"]).toMatch(/^bytes \d+-\d+\/31603$/);

    await first.evaluate((video: HTMLVideoElement) => video.play());
    await page.getByRole("button", { name: "Play video.webm", exact: true }).click();
    await expect(first).toHaveJSProperty("paused", true);
    await expect(second).toHaveJSProperty("paused", false);
    await second.evaluate((video: HTMLVideoElement) => video.pause());
    await first.evaluate((video: HTMLVideoElement) => video.requestFullscreen());
    await expect.poll(() => page.evaluate(() => document.fullscreenElement?.tagName)).toBe("VIDEO");
    await page.evaluate(() => document.exitFullscreen());

    const playbackUrl = `**${note.attachments[0].playback_url}`;
    await page.route(playbackUrl, (route) =>
      route.fulfill({ status: 503, body: "Temporarily unavailable" }),
    );
    await first.evaluate((video: HTMLVideoElement) => video.load());
    await expect(cards.nth(0).getByText("This video couldn’t play in your browser.")).toBeVisible();
    await expect(cards.nth(0).getByRole("link", { name: "Download video.mp4" })).toBeVisible();
    await page.unroute(playbackUrl);
    await cards.nth(0).getByRole("button", { name: "Try again" }).click();
    await expect(first).toHaveJSProperty("paused", false);
    await expect
      .poll(() => first.evaluate((video: HTMLVideoElement) => video.currentTime))
      .toBeGreaterThan(0.1);
    await first.evaluate((video: HTMLVideoElement) => video.pause());

    await first.evaluate((video: HTMLVideoElement) => video.play());
    const composer = page.getByRole("textbox", { name: "Message clips", exact: true });
    await composer.fill(Array(30).fill("A note below the clips.").join("\n\n"));
    await composer.press("Enter");
    await expect(page.locator(".note")).toHaveCount(2);
    await expect(first).toHaveJSProperty("paused", true);
    await page.setViewportSize({ width: 390, height: 844 });
    await first.scrollIntoViewIfNeeded();
    await expect(first).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({ path: "../../.local/screenshots/videos-mobile.png", fullPage: true });
    const downloadPromise = page.waitForEvent("download");
    await cards.nth(0).getByRole("link", { name: "Download video.mp4" }).click();
    expect((await downloadPromise).suggestedFilename()).toBe("video.mp4");
  } finally {
    await page.evaluate(async (workspace) => {
      const csrf = document.cookie
        .split("; ")
        .find((value) => value.startsWith("noted_csrf="))!
        .split("=")[1];
      const response = await fetch(`/api/v1/workspaces/${workspace}`, {
        method: "DELETE",
        headers: { "X-CSRF-Token": csrf },
      });
      if (!response.ok) throw new Error("Video fixture cleanup failed");
    }, fixture.workspace);
  }
});
