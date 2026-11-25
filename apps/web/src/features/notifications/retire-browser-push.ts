export async function retireBrowserPush() {
  if (!("serviceWorker" in navigator)) return;
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.allSettled(
    registrations.map(async (registration) => {
      const workers = [
        registration.active,
        registration.waiting,
        registration.installing,
      ];
      if (
        !workers.some((worker) => {
          if (!worker) return false;
          const url = new URL(worker.scriptURL);
          return (
            url.origin === window.location.origin &&
            url.pathname === "/notifications-sw.js"
          );
        })
      )
        return;
      await Promise.allSettled([
        registration.pushManager
          .getSubscription()
          .then((subscription) => subscription?.unsubscribe()),
        registration
          .getNotifications()
          .then((notifications) =>
            notifications.forEach((item) => item.close()),
          ),
      ]);
      await registration.unregister();
    }),
  );
}
