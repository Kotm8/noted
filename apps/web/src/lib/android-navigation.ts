import { useEffect, useEffectEvent, useLayoutEffect } from "react";
import { isAndroidApp } from "../features/notifications/android";
import { androidPilot, isAndroidPilot } from "./android-pilot";

type Layer = { id: string; path: string; close: () => void };
const layers: Layer[] = [];
const pilotLayers: (() => void)[] = [];
let ignoredPops = 0;
let previousPath = window.location.pathname;

const composerInput = ".composer textarea, .thread-composer textarea";

function initializeComposerKeyboard() {
  let tappedOutside: HTMLTextAreaElement | null = null;
  document.addEventListener(
    "pointerdown",
    (event) => {
      const input = document.activeElement;
      tappedOutside =
        event.pointerType !== "mouse" &&
        input instanceof HTMLTextAreaElement &&
        input.matches(composerInput) &&
        event.target instanceof Element &&
        !event.target.closest(
          ".composer-area, .thread-composer, textarea, input, select, [contenteditable], [role=menu], [role=dialog]",
        )
          ? input
          : null;
    },
    true,
  );
  document.addEventListener(
    "pointercancel",
    () => {
      tappedOutside = null;
    },
    true,
  );
  document.addEventListener(
    "click",
    () => {
      if (!tappedOutside) return;
      tappedOutside.blur();
      tappedOutside = null;
      void androidPilot.hideKeyboard().catch(() => {});
    },
    true,
  );
  window.addEventListener("noted:keyboard-hidden", () => {
    const input = document.activeElement;
    if (input instanceof HTMLTextAreaElement && input.matches(composerInput))
      input.blur();
  });
}

export function initializeAndroidNavigation() {
  if (!isAndroidApp()) return;
  if (isAndroidPilot) {
    initializeComposerKeyboard();
    window.addEventListener("noted:android-back", (event) => {
      const close = pilotLayers.at(-1);
      if (!close) return;
      event.preventDefault();
      close();
    });
  }
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
  useLayoutEffect(() => {
    if (!open || !isAndroidPilot) return;
    const dismiss = () => close();
    pilotLayers.push(dismiss);
    return () => {
      pilotLayers.splice(pilotLayers.indexOf(dismiss), 1);
    };
  }, [open]);
  useEffect(() => {
    if (!open || !isAndroidApp() || isAndroidPilot) return;
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
