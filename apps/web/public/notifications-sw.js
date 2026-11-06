const worker = globalThis.self;
const { URL, URLSearchParams, fetch } = globalThis;

function notificationToken(data) {
  if (data.kind === "diagnostic") return null;
  const kind = data.kind || "reminder";
  const id =
    kind === "plan"
      ? data.promptId
      : kind === "habit"
        ? data.habitReminderId
        : kind === "writing"
          ? data.writingPromptId
          : data.messageId;
  return id && Number.isInteger(data.revision)
    ? `${kind}:${id}:${data.revision}`
    : null;
}

async function staleTokens(tokens) {
  const params = new URLSearchParams();
  tokens.slice(0, 100).forEach((token) => params.append("items", token));
  if (!tokens.length) return [];
  const response = await fetch(`/api/v1/notifications/reconcile?${params}`, {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Notification sync unavailable");
  return (await response.json()).stale;
}

worker.addEventListener("message", (event) => {
  if (event.data?.type !== "noted:reconcile-notifications") return;
  event.waitUntil(
    (async () => {
      const shown = await worker.registration.getNotifications();
      const stale = new Set(
        await staleTokens(
          shown
            .map((item) => notificationToken(item.data || {}))
            .filter(Boolean),
        ),
      );
      shown.forEach((item) => {
        if (stale.has(notificationToken(item.data || {}))) item.close();
      });
    })().catch(() => {}),
  );
});

worker.addEventListener("install", (event) => {
  event.waitUntil(worker.skipWaiting());
});

worker.addEventListener("activate", (event) => {
  event.waitUntil(worker.clients.claim());
});

worker.addEventListener("push", (event) => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    (async () => {
      const token = notificationToken(data);
      if (token) {
        try {
          if ((await staleTokens([token])).includes(token)) return;
        } catch {
          return;
        }
      }
      return worker.registration.showNotification(data.title, {
        body: data.body,
        icon: "/favicon.svg",
        tag:
          data.kind === "habit"
            ? `habit-${data.habitReminderId}`
            : data.kind === "diagnostic"
              ? `noted-test-${data.testId}`
              : data.kind === "plan"
                ? `plan-${data.promptId}`
                : data.kind === "writing"
                  ? `writing-${data.writingPromptId}`
                  : `reminder-${data.messageId}`,
        data,
        actions:
          data.kind === "habit"
            ? [{ action: "open-habit", title: "View habit" }]
            : data.kind === "diagnostic"
              ? []
              : data.kind === "plan"
                ? [{ action: "open-plan", title: "View activity" }]
                : data.kind === "writing"
                  ? [{ action: "open-channel", title: "Write in channel" }]
                  : [
                      { action: "done", title: "Done" },
                      {
                        action: "snooze",
                        title: `Snooze ${data.snoozeMinutes}m`,
                      },
                    ],
      });
    })(),
  );
});

worker.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data ?? {};
  const url = new URL(data.url || "/", worker.location.origin);
  if (url.origin !== worker.location.origin) return;
  if (
    data.kind !== "diagnostic" &&
    data.kind !== "plan" &&
    data.kind !== "writing" &&
    data.kind !== "habit" &&
    (event.action === "done" || event.action === "snooze")
  ) {
    url.searchParams.set("reminderAction", event.action);
    url.searchParams.set("revision", String(data.revision));
    if (event.action === "snooze" && Number.isInteger(data.snoozeMinutes)) {
      url.searchParams.set("snoozeMinutes", String(data.snoozeMinutes));
    }
  }
  event.waitUntil(
    worker.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(async (clients) => {
        const existing = clients.find(
          (client) => new URL(client.url).origin === url.origin,
        );
        if (existing) {
          await existing.navigate(url.href);
          await existing.focus();
        } else await worker.clients.openWindow(url.href);
      }),
  );
});
