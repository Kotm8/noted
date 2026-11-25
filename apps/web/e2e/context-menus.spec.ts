import { expect, test, type Page } from "./fixtures";

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

async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill("ilya");
  await page
    .getByLabel("Password", { exact: true })
    .fill("browser-test-password-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".app-shell")).toBeVisible();
}

test("item context menus reuse message, attachment and navigation actions", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await login(page);
  const project = await api(page, "/workspaces", "POST", { name: "Personal" });
  const channel = await api(
    page,
    `/workspaces/${project.id}/channels`,
    "POST",
    { name: "thoughts" },
  );
  const message = await api(page, `/channels/${channel.id}/messages`, "POST", {
    content: "Keep this message",
  });
  const reply = await api(page, `/messages/${message.id}/thread`, "POST", {
    content: "A thread reply",
  });
  await page.goto(`/w/${project.id}/c/${channel.id}`);
  const note = page.locator(`#note-${message.id}`);
  await note.click({ button: "right", position: { x: 120, y: 15 } });
  const menu = page.getByRole("menu", { name: "Message actions", exact: true });
  await expect(menu).toBeVisible();
  await page.screenshot({ path: "../../.local/context-menu-message.png" });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (window as unknown as { copied: string }).copied = text;
        },
      },
    }),
  );
  await menu.getByRole("menuitem", { name: "Copy text", exact: true }).click();
  expect(
    await page.evaluate(() => (window as unknown as { copied: string }).copied),
  ).toBe("Keep this message");
  await note.focus();
  await note.press("Shift+F10");
  await expect(menu).toBeVisible();
  await menu.getByRole("menuitem", { name: "Remind me", exact: true }).click();
  const schedule = page.getByRole("dialog", { name: "Remind me", exact: true });
  await expect(schedule).toBeVisible();
  await schedule
    .getByRole("button", { name: "Set reminder", exact: true })
    .click();
  await expect(note.locator(".reminder-time")).toBeVisible();
  await note.click({ button: "right", position: { x: 120, y: 15 } });
  await menu
    .getByRole("menuitem", { name: "Delete note", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Delete this note?", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Keep note", exact: true }).click();
  await expect(note).toContainText("Keep this message");
  await note.click({ button: "right", position: { x: 120, y: 15 } });
  await menu
    .getByRole("menuitem", { name: "Reply in thread", exact: true })
    .click();
  await expect(
    page.getByRole("complementary", {
      name: "Thread \u00b7 #thoughts",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .locator(`#note-${reply.id}`)
    .click({ button: "right", position: { x: 100, y: 10 } });
  await expect(
    page.getByRole("menuitem", { name: "Copy text", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Reply in thread", exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Close sidebar", exact: true })
    .click();

  const row = page.locator(`[data-channel-id="${channel.id}"]`);
  await row.click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Pin to Home", exact: true })
    .click();
  await expect(page.locator(".sidebar-pins")).toContainText("thoughts");
  await page
    .locator(".channel-tree")
    .click({ button: "right", position: { x: 190, y: 190 } });
  await page
    .getByRole("menuitem", { name: "Create category", exact: true })
    .click();
  const category = page.getByRole("dialog", {
    name: "Create category",
    exact: true,
  });
  await category.getByLabel("Name", { exact: true }).fill("Writing");
  await category
    .getByRole("button", { name: "Create category", exact: true })
    .click();
  await expect(page.locator(".category-heading")).toContainText("Writing");
  await page.locator(".category-heading").click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Add channel", exact: true })
    .click();
  const create = page.getByRole("dialog", {
    name: "Create channel",
    exact: true,
  });
  await create.getByLabel("Name", { exact: true }).fill("ideas");
  await create
    .getByRole("button", { name: "Create channel", exact: true })
    .click();
  await expect(page.locator(".category")).toContainText("ideas");
  const before = page.url();
  await page
    .getByRole("button", { name: "Open workspace Personal", exact: true })
    .click({ button: "right" });
  await expect(
    page.getByRole("menuitem", { name: "Edit workspace", exact: true }),
  ).toBeVisible();
  expect(page.url()).toBe(before);
  await page.keyboard.press("Escape");

  const file = await page.evaluate(
    async ({ channel }) => {
      const canvas = document.createElement("canvas");
      canvas.width = 2;
      canvas.height = 2;
      canvas.getContext("2d")!.fillRect(0, 0, 2, 2);
      const picture = await new Promise<Blob>((resolve) =>
        canvas.toBlob((blob) => resolve(blob!), "image/png"),
      );
      const form = new FormData();
      form.set("content", "An image");
      form.append("files", picture, "pixel.png");
      const csrf =
        document.cookie
          .split("; ")
          .find((value) => value.startsWith("noted_csrf="))
          ?.split("=")[1] ?? "";
      const response = await fetch(
        `/api/v1/channels/${channel}/messages/with-files`,
        { method: "POST", headers: { "X-CSRF-Token": csrf }, body: form },
      );
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    },
    { channel: channel.id },
  );
  await page.goto(`/w/${project.id}/c/${channel.id}`);
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        write: async (items: ClipboardItem[]) => {
          const blob = await items[0].getType("image/png");
          (window as unknown as { imageBytes: number }).imageBytes = blob.size;
        },
      },
    }),
  );
  const image = page.locator(`#note-${file.id} .image-attachment`);
  await image.click({ button: "right" });
  await page.screenshot({ path: "../../.local/context-menu-image.png" });
  await expect(
    page.getByRole("menuitem", { name: "Copy image", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("menu", { name: "Message actions", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Copy image", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { imageBytes: number }).imageBytes,
      ),
    )
    .toBeGreaterThan(0);
  const input = page.getByRole("textbox", {
    name: "Message thoughts",
    exact: true,
  });
  await input.fill("Draft that stays");
  const prevented = await input.evaluate((element) => {
    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(prevented).toBe(false);
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(input).toHaveValue("Draft that stays");
  expect(errors).toEqual([]);
});

test("context menus preserve calendar planning and confirm habit, journal and meal changes", async ({
  page,
}) => {
  await login(page);
  const project = await api(page, "/workspaces", "POST", { name: "Personal" });
  const journal = await api(
    page,
    `/workspaces/${project.id}/channels`,
    "POST",
    { name: "journal", kind: "journal" },
  );
  const entry = await api(page, `/channels/${journal.id}/journal`, "POST", {
    title: "First entry",
  });
  await page.goto(`/w/${project.id}/c/${journal.id}`);
  await page.locator(".journal-entry-row").click({ button: "right" });
  await expect(
    page.getByRole("complementary", { name: "Journal entry", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("menuitem", { name: "Delete entry", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Delete journal entry", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Keep entry", exact: true }).click();
  expect((await api(page, `/journal/${entry.id}`)).title).toBe("First entry");
  const day = new Date().toISOString().slice(0, 10);
  const habit = await api(page, "/habits", "POST", {
    name: "Read",
    starts_on: day,
    timezone: "UTC",
  });
  await page.goto(`/habits?day=${day}`);
  await page.locator(".habit-row").click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Complete today", exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", { name: "Read", exact: true }),
  ).toBeChecked();
  await page.locator(".habit-row").click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Remove habit", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Remove habit", exact: true }),
  ).toContainText("Existing history is kept");
  await page.getByRole("button", { name: "Keep habit", exact: true }).click();
  expect(habit.name).toBe("Read");

  const activity = await api(page, "/time-tracking/activities", "POST", {
    name: "Study",
    icon: "BookOpen",
    color: "#e2c15a",
  });
  const plan = await api(page, "/schedule/plans", "POST", {
    title: "Reading plan",
    activity_id: activity.id,
    date: day,
    start_minute: 600,
    end_minute: 660,
    timezone: "UTC",
    frequency: "none",
    weekdays: [],
  });
  await page.goto(`/schedule?date=${day}`);
  await page
    .locator("[data-plan]")
    .filter({ hasText: "Reading plan" })
    .click({ button: "right" });
  await expect(
    page.getByRole("menuitem", { name: "Edit plan", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("menuitem", { name: "Delete plan", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Delete this plan?", exact: true }),
  ).toBeVisible();
  expect((await api(page, `/schedule/plans/${plan.id}`)).title).toBe(
    "Reading plan",
  );
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  const track = page.locator(`[data-draw][data-date="${day}"]`).first();
  await track.click({ button: "right", position: { x: 40, y: 35 } });
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");

  await api(page, "/nutrition/profile", "PUT", {
    age: 25,
    sex: "male",
    height_cm: 180,
    weight_kg: 75,
    activity: "light",
  });
  await api(page, "/nutrition/target", "PUT", {
    kcal: 2400,
    protein: 150,
    carbs: 280,
    fat: 80,
  });
  await api(page, "/nutrition/meals", "POST", {
    day,
    minute: 600,
    slot: "Breakfast",
    name: "Oats",
    items: [{ name: "Oats", kcal: 250 }],
  });
  await page.route("**/api/v1/ai/status", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      json: { ...(await response.json()), connected: true },
    });
  });
  await page.goto("/nutrition");
  await page.locator(".nutrition-meal").click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Delete meal", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Delete Oats?", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Keep it", exact: true }).click();
  await expect(page.locator(".nutrition-meal")).toContainText("Oats");
});

test.describe("touch context handling", () => {
  test.use({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 320, height: 640 },
  });
  test("a touch hold opens message actions while taps and swipes do not", async ({
    context,
    page,
  }) => {
    await login(page);
    const project = await api(page, "/workspaces", "POST", {
      name: "Personal",
    });
    const channel = await api(
      page,
      `/workspaces/${project.id}/channels`,
      "POST",
      { name: "thoughts" },
    );
    const message = await api(
      page,
      `/channels/${channel.id}/messages`,
      "POST",
      { content: "Keep this message" },
    );
    const editedText = "Keep this edited message";
    await api(page, `/messages/${message.id}`, "PUT", {
      content: editedText,
      expected_content: "Keep this message",
    });
    await page.goto(`/w/${project.id}/c/${channel.id}`);
    const note = page.locator(`#note-${message.id}`);
    await note.getByText(editedText).tap();
    const menu = page.getByRole("menu", { name: "Message actions" });
    await expect(menu).toHaveCount(0);
    await expect(note.locator(".note-actions")).toBeHidden();

    const touch = await context.newCDPSession(page);
    const bounds = await note.getByText(editedText).boundingBox();
    if (!bounds) throw new Error("The touch target is missing.");
    const point = {
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2,
    };
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [point],
    });
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ ...point, y: point.y + 50 }],
    });
    await page.waitForTimeout(800);
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await expect(menu).toHaveCount(0);

    await touch.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [point],
    });
    await expect(menu).toBeVisible();
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await expect(
      menu.getByRole("menuitem", { name: "Reply in thread" }),
    ).toBeVisible();
    expect(
      await menu.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return bounds.left >= 0 && bounds.right <= innerWidth;
      }),
    ).toBe(true);
    await menu.getByRole("menuitem", { name: "Edit history" }).tap();
    const history = page.getByRole("dialog", { name: "Edit history" });
    await expect(history).toContainText(editedText);
    await expect(history).toContainText("Keep this message");
  });
});
