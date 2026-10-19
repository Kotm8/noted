import { useEffect, useEffectEvent } from "react";
import { isAndroidApp } from "../features/notifications/android";

type Layer = { id: string; path: string; close: () => void };
const layers: Layer[] = [];
let ignoredPops = 0;
let previousPath = window.location.pathname;

export function initializeAndroidNavigation() {
  if (!isAndroidApp()) return;
  if (window.history.state?.idx == null && window.location.pathname !== "/") {
    const destination = window.location.href;
    window.history.replaceState({ idx: 0, key: "home" }, "", "/");
    window.history.pushState(
      { idx: 1, key: crypto.randomUUID() },
      "",
      destination,
    );
  }
  window.addEventListener("popstate", (event) => {
    if (ignoredPops) {
      ignoredPops -= 1;
      event.stopImmediatePropagation();
      return;
    }
    const layer = layers.pop();
    if (layer) {
      event.stopImmediatePropagation();
      layer.close();
      return;
    }
    if (previousPath !== "/" && window.location.pathname !== "/") {
      window.history.replaceState(window.history.state, "", "/");
    }
    previousPath = window.location.pathname;
  });
}

export function syncAndroidRoute(path: string) {
  previousPath = path;
}

export function useAndroidBackLayer(open: boolean, onClose: () => void) {
  const close = useEffectEvent(onClose);
  useEffect(() => {
    if (!open || !isAndroidApp()) return;
    let layer: Layer | undefined;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      layer = {
        id: crypto.randomUUID(),
        path: window.location.href,
        close: () => close(),
      };
      layers.push(layer);
      window.history.pushState(
        { ...window.history.state, notedLayer: layer.id },
        "",
        layer.path,
      );
    });
    return () => {
      cancelled = true;
      const index = layers.findIndex((item) => item === layer);
      if (index === -1 || !layer) return;
      layers.splice(index, 1);
      if (
        window.history.state?.notedLayer === layer.id &&
        window.location.href === layer.path
      ) {
        ignoredPops += 1;
        window.history.back();
      }
    };
  }, [open]);
}
