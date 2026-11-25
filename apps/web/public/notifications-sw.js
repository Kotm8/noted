const worker = globalThis.self;

worker.addEventListener("install", (event) => {
  event.waitUntil(worker.skipWaiting());
});

worker.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      await Promise.allSettled([
        worker.registration.pushManager
          .getSubscription()
          .then((subscription) => subscription?.unsubscribe()),
        worker.registration
          .getNotifications()
          .then((notifications) =>
            notifications.forEach((item) => item.close()),
          ),
      ]);
      await worker.registration.unregister();
    })(),
  );
});
