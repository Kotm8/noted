import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

async function api(page: Page, path: string, method = "GET", body?: unknown) {
  return page.evaluate(
    async ({ path, method, body }) => {
      const csrf =
        document.cookie
          .split("; ")
          .find((part) => part.startsWith("noted_csrf="))
          ?.split("=")[1] ?? "";
      const response = await fetch(`/api/v1${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": decodeURIComponent(csrf),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!response.ok) throw new Error(await response.text());
      return response.status === 204 ? null : response.json();
    },
    { path, method, body },
  );
}

function prepareEndPrompt(sessionId: string, notifyId?: string) {
  const root = resolve("../..");
  execFileSync(
    resolve(
      root,
      "backend/.venv",
      process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
    ),
    [
      "-c",
      "import sys; from uuid import UUID; from datetime import timedelta; from sqlalchemy.orm import Session; from app.core.config import Settings; from app.core.security import utc_now; from app.db.database import create_database_engine; from app.db import models; from app.time_tracking.models import TimeSession; from app.schedule.prompts.models import PlanPrompt; engine=create_database_engine(Settings().database_url); db=Session(engine); item=db.get(TimeSession, UUID(sys.argv[1])); item.started_at=utc_now()-timedelta(minutes=30); prompt=db.get(PlanPrompt, UUID(sys.argv[2])) if len(sys.argv)>2 else None; setattr(prompt, 'notify_at', utc_now()-timedelta(seconds=1)) if prompt else None; db.commit(); db.close(); engine.dispose()",
      sessionId,
      ...(notifyId ? [notifyId] : []),
    ],
    { cwd: resolve(root, "backend"), env: process.env },
  );
}

test("ended activity opens on Android, snoozes without moving the plan, and stops only on request", async ({
  page,
}) => {
  await page.setViewportSize({ width: 412, height: 892 });
  await page.goto("/?client=android&nativePush=1");
  await page.getByLabel("Username", { exact: true }).fill("ilya");
  await page
    .getByLabel("Password", { exact: true })
    .fill("browser-test-password-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".app-shell")).toBeVisible();
  const activity = await api(page, "/time-tracking/activities", "POST", {
    name: `End prompt ${Date.now()}`,
  });
  const tracker = await api(page, "/time-tracking/tracker");
  const running = await api(page, "/time-tracking/tracker", "POST", {
    action: "start",
    activity_id: activity.id,
    revision: tracker.revision,
    request_id: crypto.randomUUID(),
  });
  prepareEndPrompt(running.active.id);
  const end = new Date();
  const endMinute = end.getUTCHours() * 60 + end.getUTCMinutes() || 1440;
  if (endMinute === 1440) end.setUTCDate(end.getUTCDate() - 1);
  const plan = await api(page, "/schedule/plans", "POST", {
    title: "Finished focus block",
    activity_id: activity.id,
    date: end.toISOString().slice(0, 10),
    start_minute: Math.max(0, endMinute - 30),
    end_minute: endMinute,
    timezone: "UTC",
    notification_minutes: 0,
  });
  try {
    const prompt = (await api(page, "/schedule/prompts")).find(
      (item: { plan_id: string }) => item.plan_id === plan.id,
    );
    expect(prompt.phase).toBe("end");
    await page.goto(`/schedule?prompt=${prompt.id}`);
    const panel = page.getByRole("region", { name: "Planned activity prompt" });
    await expect(panel).toBeVisible();
    await expect(
      panel.getByText("ACTIVITY ENDED", { exact: true }),
    ).toBeVisible();
    await expect(
      panel.getByRole("button", { name: "Start activity", exact: true }),
    ).toHaveCount(0);
    await panel.getByRole("button", { name: "Snooze", exact: true }).click();
    await panel
      .getByRole("button", { name: "Snooze prompt", exact: true })
      .click();
    await expect(panel).toHaveCount(0);
    expect((await api(page, "/time-tracking/tracker")).active.id).toBe(
      running.active.id,
    );
    expect((await api(page, `/schedule/plans/${plan.id}`)).end_minute).toBe(
      endMinute,
    );
    prepareEndPrompt(running.active.id, prompt.id);
    await page.reload();
    await expect(panel).toBeVisible();
    await page.screenshot({
      path: "../../.local/screenshots/android-plan-ended.png",
      animations: "disabled",
    });
    await panel
      .getByRole("button", { name: "No activity", exact: true })
      .click();
    await expect(panel).toHaveCount(0);
    expect((await api(page, "/time-tracking/tracker")).active).toBeNull();
  } finally {
    await api(
      page,
      `/schedule/plans/${plan.id}?revision=${plan.revision}`,
      "DELETE",
    );
  }
});

for (const android of [false, true]) {
  test(`planned task prompts open the sidebar and keep plans fixed (${android ? "Android" : "desktop"})`, async ({
    page,
  }) => {
    if (android) await page.setViewportSize({ width: 412, height: 892 });
    await page.goto(android ? "/?client=android&nativePush=1" : "/");
    await page.getByLabel("Username", { exact: true }).fill("ilya");
    await page
      .getByLabel("Password", { exact: true })
      .fill("browser-test-password-only");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.locator(".app-shell")).toBeVisible();
    const suffix = Date.now().toString();
    const reading = await api(page, "/time-tracking/activities", "POST", {
      name: `Reading ${suffix}`,
      icon: "BookOpen",
    });
    const work = await api(page, "/time-tracking/activities", "POST", {
      name: `Work ${suffix}`,
      icon: "Code2",
    });
    const start = new Date(Date.now() + 5 * 60000);
    const minute = start.getUTCHours() * 60 + start.getUTCMinutes();
    const plans: { id: string; revision: number }[] = [];
    async function make(title: string) {
      const plan = await api(page, "/schedule/plans", "POST", {
        title,
        activity_id: reading.id,
        date: start.toISOString().slice(0, 10),
        start_minute: minute,
        end_minute: Math.min(1440, minute + 30),
        timezone: "UTC",
        notification_minutes: 10,
      });
      plans.push(plan);
      const prompts = await api(page, "/schedule/prompts");
      const prompt = prompts.find(
        (item: { plan_id: string }) => item.plan_id === plan.id,
      );
      expect(prompt).toBeTruthy();
      if (android && plans.length === 1) await page.context().clearCookies();
      await page.goto(`/schedule?prompt=${prompt.id}`);
      if (android && plans.length === 1) {
        await page.getByLabel("Username", { exact: true }).fill("ilya");
        await page
          .getByLabel("Password", { exact: true })
          .fill("browser-test-password-only");
        await page
          .getByRole("button", { name: "Sign in", exact: true })
          .click();
      }
      if (android)
        await expect(page.locator(".app-shell")).toHaveClass(/mobile-nav-open/);
      await expect(
        page
          .locator(".time-tracker .planned-task-prompt")
          .getByText(title, { exact: true }),
      ).toBeVisible();
      return { plan, prompt };
    }
    try {
      const { plan } = await make("Read the next chapter");
      const panel = page.locator(".time-tracker .planned-task-prompt");
      if (android) {
        await page.goBack();
        await expect(page.locator(".app-shell")).not.toHaveClass(
          /mobile-nav-open/,
        );
        await page.reload();
        await expect(panel).toBeVisible();
        await page
          .getByRole("button", { name: "Collapse task prompt", exact: true })
          .click();
        await page.reload();
        await expect(panel).toBeVisible();
      }
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await page.screenshot({
        path: "../../.local/screenshots/plan-prompt-sidebar.png",
      });
      await panel.getByRole("button", { name: "Delay", exact: true }).click();
      await expect(
        panel.getByRole("button", { name: "Delay prompt", exact: true }),
      ).toBeEnabled();
      await expect(
        panel.getByRole("button", { name: "Reason for delaying", exact: true }),
      ).toHaveText("Finishing up current task");
      await panel.getByRole("button", { name: "15 min", exact: true }).click();
      await page.screenshot({
        path: "../../.local/screenshots/plan-prompt-delay.png",
      });
      await panel
        .getByRole("button", { name: "Delay prompt", exact: true })
        .click();
      await expect(
        page
          .locator(".planned-task-prompt")
          .getByText("Read the next chapter", { exact: true }),
      ).toHaveCount(0);
      const unchanged = await api(page, `/schedule/plans/${plan.id}`);
      expect(unchanged.start_minute).toBe(minute);
      expect(unchanged.activity_id).toBe(reading.id);
      const delayed = await api(
        page,
        `/schedule/plans/${plan.id}/prompt-history`,
      );
      expect(delayed[0].reason).toBe("Finishing up current task");
      await make("Time to read now");
      await panel
        .getByRole("button", { name: "Start activity", exact: true })
        .click();
      await expect(page.locator(".tracker-trigger")).toContainText(
        reading.name,
      );
      const next = await make("Reading after this build");
      await panel
        .getByRole("button", { name: "Choose another activity", exact: true })
        .click();
      await panel
        .getByRole("button", { name: "Current working activity", exact: true })
        .click();
      await page
        .getByRole("menuitemradio", { name: work.name, exact: true })
        .click();
      await panel
        .getByRole("button", { name: "Reason for delaying", exact: true })
        .click();
      await page
        .getByRole("menuitemradio", { name: "Write a reason", exact: true })
        .click();
      await expect(
        panel.getByRole("button", { name: "Switch & delay", exact: true }),
      ).toBeDisabled();
      await panel
        .getByLabel("Your reason", { exact: true })
        .fill("Finishing the current build");
      await panel.getByRole("button", { name: "30 min", exact: true }).click();
      await panel
        .getByRole("button", { name: "Switch & delay", exact: true })
        .click();
      await expect(page.locator(".tracker-trigger")).toContainText(work.name);
      const history = await api(
        page,
        `/schedule/plans/${next.plan.id}/prompt-history`,
      );
      expect(history[0].reason).toBe("Finishing the current build");
      expect(history[0].minutes).toBe(30);
    } finally {
      for (const plan of plans)
        await api(
          page,
          `/schedule/plans/${plan.id}?revision=${plan.revision}`,
          "DELETE",
        );
      const state = await api(page, "/time-tracking/tracker");
      await api(page, "/time-tracking/tracker", "POST", {
        action: "stop",
        revision: state.revision,
        request_id: crypto.randomUUID(),
      });
    }
  });
}
