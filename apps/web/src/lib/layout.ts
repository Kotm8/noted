/** Matches the phone breakpoint used by the stylesheet. */
export function isMobileLayout(): boolean {
  return window.matchMedia("(max-width: 760px)").matches;
}
