const worker = globalThis.self;
const { URL } = globalThis;

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
    worker.registration.showNotification(data.title, {
      body: data.body,
      icon: "/favicon.svg",
      tag:
        data.kind === "diagnostic"
          ? `noted-test-${data.testId}`
          : data.kind === "plan"
            ? `plan-${data.promptId}`
            : data.kind === "writing"
              ? `writing-${data.writingPromptId}`
              : `reminder-${data.messageId}`,
      data,
      actions:
        data.kind === "diagnostic"
          ? []
          : data.kind === "plan"
            ? [{ action: "open-plan", title: "View activity" }]
            : data.kind === "writing"
              ? [{ action: "open-channel", title: "Write in channel" }]
              : [
                  { action: "done", title: "Done" },
                  { action: "snooze", title: `Snooze ${data.snoozeMinutes}m` },
                ],
    }),
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
