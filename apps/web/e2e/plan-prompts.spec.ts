import { expect, test, type Page } from "@playwright/test";

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

test("planned task prompts expand inside the bottom-left tracker and keep plans fixed", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill("ilya");
  await page
    .getByLabel("Password", { exact: true })
    .fill("browser-test-password-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Settings", exact: true }),
  ).toBeVisible();
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
    await page.goto(`/schedule?prompt=${prompt.id}`);
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
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.screenshot({
      path: "../../.local/screenshots/plan-prompt-sidebar.png",
    });
    await panel.getByRole("button", { name: "Delay", exact: true }).click();
    await expect(
      panel.getByRole("button", { name: "Delay prompt", exact: true }),
    ).toBeDisabled();
    await panel.getByRole("button", { name: "15 min", exact: true }).click();
    await panel
      .getByRole("button", { name: "Reason for delaying", exact: true })
      .click();
    await page
      .getByRole("menuitemradio", {
        name: "Finishing current activity",
        exact: true,
      })
      .click();
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
    await make("Time to read now");
    await panel
      .getByRole("button", { name: "Start activity", exact: true })
      .click();
    await expect(page.locator(".tracker-trigger")).toContainText(reading.name);
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
