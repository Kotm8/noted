import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, test, type Page } from "./fixtures";

const execute = promisify(execFile);

async function setup(page: Page, directory: string, android = false) {
  await execute(
    process.env.NOTED_BROWSER_TEST_PYTHON!,
    ["-m", "tests.image_fixtures", directory],
    {
      cwd: fileURLToPath(new URL("../../../backend/", import.meta.url)),
      env: process.env,
    },
  );
  await page.goto(android ? "/?client=android" : "/");
  await page.getByLabel("Username", { exact: true }).fill("ilya");
  await page
    .getByLabel("Password", { exact: true })
    .fill("browser-test-password-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".app-shell")).toBeVisible();
  const fixture = await page.evaluate(async () => {
    const csrf = document.cookie
      .split("; ")
      .find((item) => item.startsWith("noted_csrf="))!
      .slice(11);
    const headers = {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrf,
    };
    const project = await fetch("/api/v1/workspaces", {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "Images" }),
    }).then((response) => response.json());
    const channel = await fetch(`/api/v1/workspaces/${project.id}/channels`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "pictures" }),
    }).then((response) => response.json());
    return { project: project.id, channel: channel.id };
  });
  await page.goto(`/w/${fixture.project}/c/${fixture.channel}`);
  await page
    .getByLabel("Attach files", { exact: true })
    .setInputFiles([`${directory}/mountains.jpg`, `${directory}/animated.gif`]);
  const uploaded = page.waitForResponse(
    (response) =>
      response.url().endsWith("/messages/with-files") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Send note", exact: true }).click();
  const response = await uploaded;
  expect(response.status()).toBe(201);
  return { ...fixture, message: await response.json() };
}

async function animated(page: Page, selector: string) {
  const image = page.locator(selector);
  await expect(image).toHaveCSS("opacity", "1");
  const first = await image.screenshot();
  await expect
    .poll(async () => !(await image.screenshot()).equals(first), {
      timeout: 3500,
      intervals: [100, 150, 200],
    })
    .toBe(true);
  return true;
}

test("compressed previews reserve their space and the viewer loads originals with zoom and animated GIFs", async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let releasePreview!: () => void;
  const previewGate = new Promise<void>((resolve) => {
    releasePreview = resolve;
  });
  let releaseOriginal!: () => void;
  const originalGate = new Promise<void>((resolve) => {
    releaseOriginal = resolve;
  });
  const originals: string[] = [];
  await page.route("**/attachments/*/preview?*", async (route) => {
    await previewGate;
    await route.continue();
  });
  await page.route("**/attachments/*/original*", async (route) => {
    originals.push(route.request().url());
    await originalGate;
    await route.continue();
  });
  try {
    const fixture = await setup(page, info.outputPath("images"));
    const thumbnail = page.getByRole("button", {
      name: "Open image mountains.jpg",
      exact: true,
    });
    await thumbnail.scrollIntoViewIfNeeded();
    await expect(
      thumbnail.getByRole("status", { name: "Loading image" }),
    ).toBeVisible();
    const before = await thumbnail.boundingBox();
    await page.screenshot({ path: "../../.local/image-skeleton-app.png" });
    expect(originals).toEqual([]);
    releasePreview();
    await expect(thumbnail).toHaveAttribute("aria-busy", "false");
    const after = await thumbnail.boundingBox();
    expect(after!.width).toBe(before!.width);
    expect(after!.height).toBe(before!.height);
    const gif = page.getByRole("button", {
      name: "Open image animated.gif",
      exact: true,
    });
    await gif.scrollIntoViewIfNeeded();
    await expect(gif).toHaveAttribute("aria-busy", "false");
    expect(await animated(page, '.image-open img[alt="animated.gif"]')).toBe(
      true,
    );
    expect(originals).toEqual([]);
    await thumbnail.click();
    const viewer = page.getByRole("dialog", {
      name: "Image viewer",
      exact: true,
    });
    await expect(viewer).toBeVisible();
    await expect(
      viewer.getByText("Loading full quality…", { exact: true }),
    ).toBeVisible();
    await expect(viewer.locator(".image-viewer-preview")).toBeVisible();
    releaseOriginal();
    await expect(
      viewer.getByText("Original quality", { exact: true }),
    ).toBeVisible();
    await viewer.locator(".image-viewer-picture").dblclick();
    await expect(
      viewer.getByRole("button", { name: "Fit image", exact: true }),
    ).toHaveText("200%");
    await viewer
      .getByRole("button", { name: "Fit image", exact: true })
      .click();
    await viewer.getByRole("button", { name: "Zoom in", exact: true }).click();
    await expect(
      viewer.getByRole("button", { name: "Fit image", exact: true }),
    ).toHaveText("150%");
    const picture = viewer.locator(".image-viewer-picture");
    const box = await picture.boundingBox();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.wheel(0, -200);
    await expect(
      viewer.getByRole("button", { name: "Fit image", exact: true }),
    ).not.toHaveText("150%");
    const transform = await picture.evaluate(
      (node) => getComputedStyle(node).transform,
    );
    await page.mouse.down();
    await page.mouse.move(
      box!.x + box!.width / 2 + 60,
      box!.y + box!.height / 2 + 30,
      { steps: 5 },
    );
    await page.mouse.up();
    await expect(picture).not.toHaveCSS("transform", transform);
    await expect(viewer).toBeVisible();
    await viewer
      .getByRole("button", { name: "Fit image", exact: true })
      .click();
    await page.screenshot({ path: "../../.local/image-viewer-app.png" });
    const downloadEvent = page.waitForEvent("download");
    await viewer
      .getByRole("link", { name: "Download original image", exact: true })
      .click();
    const download = await downloadEvent;
    expect(await readFile((await download.path())!)).toEqual(
      await readFile(`${info.outputPath("images")}/mountains.jpg`),
    );
    await page.keyboard.press("ArrowRight");
    await expect(viewer.locator(".image-viewer-file strong")).toHaveText(
      "animated.gif",
    );
    await expect(
      viewer.getByText("Original quality", { exact: true }),
    ).toBeVisible();
    expect(await animated(page, ".image-viewer-original")).toBe(true);
    await page.keyboard.press("ArrowLeft");
    await expect(viewer.locator(".image-viewer-file strong")).toHaveText(
      "mountains.jpg",
    );
    await page.keyboard.press("Escape");
    await expect(viewer).toHaveCount(0);
    await expect(thumbnail).toBeFocused();
    await thumbnail.click();
    const stage = page.locator(".image-viewer-stage");
    await stage.click({ position: { x: 5, y: 5 } });
    await expect(viewer).toHaveCount(0);
    expect(fixture.message.attachments[0].width).toBe(2400);
    expect(errors).toEqual([]);
  } finally {
    releasePreview();
    releaseOriginal();
  }
});

test("a failed preview keeps its dimensions and can be retried", async ({
  page,
}, info) => {
  let fail = true;
  await page.route("**/attachments/*/preview?*", async (route) => {
    if (fail) await route.fulfill({ status: 503, body: "Unavailable" });
    else await route.continue();
  });
  await setup(page, info.outputPath("images"));
  const image = page.locator(".image-attachment").first();
  await expect(
    image.getByText("Couldn't load image", { exact: true }),
  ).toBeVisible();
  const before = await image.boundingBox();
  fail = false;
  await image.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(image.locator(".image-open")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  expect((await image.boundingBox())!.height).toBe(before!.height);
  await expect(
    image.getByText("Couldn't load image", { exact: true }),
  ).toHaveCount(0);
});

test.describe("Android image viewer", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  test("swipe, pinch and Android Back work without opening channel navigation", async ({
    page,
  }, info) => {
    const fixture = await setup(page, info.outputPath("images"), true);
    await page
      .getByRole("button", { name: "Open image mountains.jpg", exact: true })
      .tap();
    const viewer = page.getByRole("dialog", {
      name: "Image viewer",
      exact: true,
    });
    await expect(
      viewer.getByText("Original quality", { exact: true }),
    ).toBeVisible();
    const cdp = await page.context().newCDPSession(page);
    const bounds = await page.locator(".image-viewer-stage").boundingBox();
    const y = bounds!.y + bounds!.height / 2;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: 280, y, id: 1 }],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: 110, y, id: 1 }],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await expect(viewer.locator(".image-viewer-file strong")).toHaveText(
      "animated.gif",
    );
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        { x: 150, y, id: 1 },
        { x: 230, y, id: 2 },
      ],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { x: 110, y, id: 1 },
        { x: 270, y, id: 2 },
      ],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await expect(
      viewer.getByRole("button", { name: "Fit image", exact: true }),
    ).not.toHaveText("100%");
    await page.screenshot({ path: "../../.local/image-viewer-phone.png" });
    await page.goBack();
    await expect(viewer).toHaveCount(0);
    await expect(page).toHaveURL(
      new RegExp(`/w/${fixture.project}/c/${fixture.channel}$`),
    );
    await expect(page.locator(".app-shell")).not.toHaveClass(/mobile-nav-open/);
  });
});
