import { useSyncExternalStore } from "react";

/** Matches the phone breakpoint used by the stylesheet. */
export function isMobileLayout(): boolean {
  return window.matchMedia("(max-width: 760px)").matches;
}

const mobileQuery = "(max-width: 760px)";
function subscribeMobile(callback: () => void) {
  const query = window.matchMedia(mobileQuery);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}
export function useMobileLayout() {
  return useSyncExternalStore(subscribeMobile, isMobileLayout, () => false);
}
