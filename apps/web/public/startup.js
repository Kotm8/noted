(() => {
  const screen = globalThis.document.getElementById("noted-startup");
  const failure = screen?.querySelector(".startup-failure");
  const timer = globalThis.window.setTimeout(() => {
    if (!screen?.isConnected) return;
    screen.dataset.state = "failed";
    screen.removeAttribute("aria-busy");
    failure.hidden = false;
  }, 20000);
  globalThis.document
    .getElementById("startup-retry")
    ?.addEventListener("click", () => globalThis.window.location.reload());
  globalThis.window.addEventListener(
    "noted:ready",
    () => {
      globalThis.window.clearTimeout(timer);
      screen?.remove();
    },
    { once: true },
  );
})();
