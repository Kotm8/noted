import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

async function api(page: Page, path: string, method = "GET", body?: unknown) {
  return page.evaluate(
    async ({ path, method, body }) => {
      const csrf = document.cookie
        .split("; ")
        .find((value) => value.startsWith("noted_csrf="))
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
      return response.status === 204 ? null : response.json();
    },
    { path, method, body },
  );
}

async function signIn(page: Page, path = "/") {
  await page.goto(path);
  await page.getByLabel("Username", { exact: true }).fill("ilya");
  await page
    .getByLabel("Password", { exact: true })
    .fill("browser-test-password-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".app-shell")).toBeVisible();
}

function makeDue(id: string) {
  const root = resolve("../..");
  const python = resolve(
    root,
    "backend/.venv",
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
  );
  execFileSync(
    python,
    [
      "-c",
      "import sys; from uuid import UUID; from datetime import timedelta; from sqlalchemy.orm import Session; from app.core.config import Settings; from app.core.security import utc_now; from app.db.database import create_database_engine; from app.db import models; from app.reminders.models import Reminder; engine=create_database_engine(Settings().database_url); db=Session(engine); item=db.get(Reminder, UUID(sys.argv[1])); item.due_at=utc_now()-timedelta(minutes=5); db.commit(); db.close(); engine.dispose()",
      id,
    ],
    { cwd: resolve(root, "backend"), env: process.env },
  );
}

test("H02 opens the real calendar and projects, and read activity survives a reload", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await signIn(page);
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Your places", { exact: true })).toHaveCount(0);
  const project = await api(page, "/workspaces", "POST", {
    name: "Home study",
  });
  const channel = await api(
    page,
    `/workspaces/${project.id}/channels`,
    "POST",
    { name: "reading", kind: "reminder" },
  );
  const tracker = await api(page, "/time-tracking/tracker");
  await api(page, "/time-tracking/preferences", "PUT", {
    ...tracker.preferences,
    timezone: "UTC",
    revision: tracker.revision,
  });
  const now = new Date(tracker.server_time);
  const activity = await api(page, "/time-tracking/activities", "POST", {
    name: "Reading for Home",
  });
  await api(page, "/schedule/plans", "POST", {
    activity_id: activity.id,
    title: "A real calendar plan",
    date: now.toISOString().slice(0, 10),
    start_minute: now.getUTCHours() * 60 + now.getUTCMinutes(),
    end_minute: Math.min(
      1440,
      now.getUTCHours() * 60 + now.getUTCMinutes() + 45,
    ),
    timezone: "UTC",
    notifications_enabled: false,
  });
  const message = await api(page, `/channels/${channel.id}/messages`, "POST", {
    content: "A reminder for Home",
    reminder: { due_at: new Date(Date.now() + 86400000).toISOString() },
  });
  makeDue(message.id);
  await page.reload();
  await expect(page.locator(".home-agenda")).toContainText(
    "A real calendar plan",
  );
  const missed = page.getByRole("region", { name: "Missed activity" });
  await expect(missed).toContainText("A reminder for Home");
  await missed
    .getByRole("button", {
      name: "Mark read: A reminder for Home",
      exact: true,
    })
    .click();
  await expect(
    missed
      .locator(".home-missed-item")
      .filter({ hasText: "A reminder for Home" }),
  ).toHaveClass(/is-read/);
  await page.reload();
  await expect(
    page
      .locator(".home-missed-item")
      .filter({ hasText: "A reminder for Home" }),
  ).toHaveClass(/is-read/);
  expect(
    (await api(page, `/channels/${channel.id}/messages`)).items.find(
      (item: { id: string }) => item.id === message.id,
    ).reminder.status,
  ).toBe("active");
  await page
    .getByRole("button", { name: "Full calendar", exact: true })
    .click();
  await expect(page.locator(".schedule-grid")).toBeVisible();
  await expect(
    page
      .locator(".planned-block")
      .filter({ hasText: "A real calendar plan" })
      .first(),
  ).toBeVisible();
  await page
    .locator(".workspace-rail")
    .getByRole("button", { name: "Home", exact: true })
    .click();
  await page
    .locator(".home-project-navigation")
    .getByRole("button", { name: "Home study", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "reading", exact: true }),
  ).toBeVisible();
  await page
    .locator(".workspace-rail")
    .getByRole("button", { name: "Home", exact: true })
    .click();
  await page
    .locator(".home-notification-title")
    .filter({ hasText: "A reminder for Home" })
    .click();
  await expect(page.locator(`#note-${message.id}`)).toBeVisible();
  await page
    .locator(".workspace-rail")
    .getByRole("button", { name: "Home", exact: true })
    .click();
  await page.screenshot({
    path: "../../.local/screenshots/home-implemented.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "Full calendar", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "../../.local/screenshots/home-implemented-phone.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("Android Back closes panels before returning from channels and Calendar to Home", async ({
  page,
}) => {
  await page.setViewportSize({ width: 412, height: 892 });
  await signIn(page, "/?client=android&nativePush=1");
  const project = await api(page, "/workspaces", "POST", {
    name: "Android Home",
  });
  const one = await api(page, `/workspaces/${project.id}/channels`, "POST", {
    name: "first",
  });
  const two = await api(page, `/workspaces/${project.id}/channels`, "POST", {
    name: "second",
  });
  await page.goto(`/w/${project.id}/c/${one.id}?client=android&nativePush=1`);
  await expect(
    page.getByRole("heading", { name: "first", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open search", exact: true }).click();
  await expect(page.locator(".search-sidebar")).toBeVisible();
  await page.goBack();
  await expect(page.locator(".search-sidebar")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "first", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Open navigation", exact: true })
    .click();
  await page
    .locator(".channel-tree")
    .getByRole("button", { name: "second", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "second", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Message second" })
    .fill("Keep this draft when I go Home");
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Full calendar", exact: true })
    .click();
  await expect(page.locator(".schedule-grid")).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Open navigation", exact: true })
    .click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Settings", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Time tracking", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Schedule start", exact: true })
    .click();
  await expect(page.getByRole("menu")).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(
    page.getByRole("dialog", { name: "Settings", exact: true }),
  ).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole("dialog", { name: "Settings", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible();
  expect(one.id).not.toBe(two.id);
  await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  await page.locator(".home-project-navigation").getByRole("button", { name: "Android Home", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Message second" })).toHaveValue("Keep this draft when I go Home");
});

test("startup offers recovery when the application bundle cannot load", async ({
  page,
}) => {
  await page.clock.install();
  await page.route("**/src/main.tsx", (route) => route.abort());
  await page.goto("/");
  await expect(page.locator("#noted-startup")).toBeVisible();
  await page.clock.fastForward(21000);
  await expect(
    page.getByText(
      "Noted couldn't finish loading. Check your connection and try again.",
    ),
  ).toBeVisible();
  await page.unroute("**/src/main.tsx");
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByLabel("Username", { exact: true })).toBeVisible();
});

test("startup draws the logo, handles failed connections, and respects reduced motion", async ({
  page,
}) => {
  await page.route("**/api/v1/auth/session", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await route.abort();
  });
  await page.goto("/");
  await expect(page.locator("#noted-startup")).toBeVisible();
  expect(
    await page
      .locator("#noted-startup .startup-curve")
      .evaluate((el) => getComputedStyle(el).animationDelay),
  ).toBe("0.24s");
  expect(
    await page
      .locator("#noted-startup .startup-dot")
      .evaluate((el) => getComputedStyle(el).animationDelay),
  ).toBe("0.68s");
  await expect(
    page.getByRole("heading", { name: "Let's reconnect." }),
  ).toBeVisible();
  await expect(page.locator("#noted-startup")).toHaveCount(0);
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Let's reconnect." }),
  ).toBeVisible();
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await page
      .locator(".startup-dot")
      .evaluate((el) => getComputedStyle(el).animationName),
  ).toBe("none");
});
