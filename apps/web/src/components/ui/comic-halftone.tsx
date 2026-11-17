import { useEffect, useRef } from "react";
import { drawSnow, drawStars } from "./ambient-backgrounds";

const step = 50;
const maxRadius = 12;
const driftPerSecond = 2.6;
const bandLength = 560;
const bandSeconds = 95;
const crossLength = 820;
const crossSeconds = 110;
const opacity = 0.14;
const frameInterval = 1000 / 30;

const canvases = new Set<HTMLCanvasElement>();
let frame = 0;
let lastFrame = 0;
let accent = "";
let ink = "";
let profile = "modern";
let resize: ResizeObserver | null = null;
let watcher: MutationObserver | null = null;
let motion: MediaQueryList | null = null;

const reducedMotion = () =>
  Boolean(motion?.matches) ||
  document.documentElement.dataset.reducedMotion === "true";

const smoothstep = (edge0: number, edge1: number, value: number) => {
  const x = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return x * x * (3 - 2 * x);
};

function radiusAt(x: number, y: number, seconds: number) {
  const along = (x + y) / Math.SQRT2;
  const across = (x - y) / Math.SQRT2;
  const band = Math.sin(
    2 * Math.PI * (along / bandLength + seconds / bandSeconds),
  );
  const cross = Math.sin(
    2 * Math.PI * (across / crossLength - seconds / crossSeconds) + 1.3,
  );
  return maxRadius * smoothstep(0.16, 1, 0.5 + 0.38 * band + 0.12 * cross);
}

function draw(canvas: HTMLCanvasElement, seconds: number) {
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const width = Math.round(rect.width * ratio);
  const height = Math.round(rect.height * ratio);
  const context = canvas.getContext("2d");
  if (!width || !height || !context) return;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, rect.width, rect.height);
  if (profile === "snow") {
    drawSnow(context, rect, seconds, ink);
    return;
  }
  if (profile === "stars") {
    drawStars(context, rect, seconds, accent, ink);
    return;
  }
  context.fillStyle = accent;
  context.globalAlpha = opacity;
  const drift = (seconds * driftPerSecond) % step;
  const rowStep = step / 2;
  const firstRow = Math.floor((rect.top - drift - maxRadius) / rowStep);
  const lastRow = Math.ceil((rect.bottom - drift + maxRadius) / rowStep);
  context.beginPath();
  for (let row = firstRow; row <= lastRow; row += 1) {
    const y = row * rowStep + drift;
    const offset = (((row % 2) + 2) % 2) * rowStep + drift;
    const firstColumn = Math.floor((rect.left - offset - maxRadius) / step);
    const lastColumn = Math.ceil((rect.right - offset + maxRadius) / step);
    for (let column = firstColumn; column <= lastColumn; column += 1) {
      const x = column * step + offset;
      const radius = radiusAt(x, y, seconds);
      if (radius < 0.4) continue;
      context.moveTo(x - rect.left + radius, y - rect.top);
      context.arc(x - rect.left, y - rect.top, radius, 0, 2 * Math.PI);
    }
  }
  context.fill();
}

const drawAll = (seconds: number) =>
  canvases.forEach((canvas) => draw(canvas, seconds));

function tick(now: number) {
  frame = requestAnimationFrame(tick);
  if (now - lastFrame < frameInterval) return;
  lastFrame = now;
  drawAll(now / 1000);
}

function refresh() {
  const root = document.documentElement;
  const styles = getComputedStyle(root);
  accent = styles.getPropertyValue("--accent").trim();
  ink = styles.getPropertyValue("--text-primary").trim();
  profile = root.dataset.backgroundProfile ?? "modern";
  cancelAnimationFrame(frame);
  frame = 0;
  if (profile === "modern" || !canvases.size || document.hidden) return;
  if (reducedMotion()) drawAll(0);
  else frame = requestAnimationFrame(tick);
}

const redrawStill = () => {
  if (reducedMotion() && profile !== "modern" && !document.hidden) drawAll(0);
};

function start() {
  motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  motion.addEventListener("change", refresh);
  window.addEventListener("resize", redrawStill);
  window.addEventListener("scroll", redrawStill, {
    capture: true,
    passive: true,
  });
  document.addEventListener("visibilitychange", refresh);
  resize = new ResizeObserver(redrawStill);
  watcher = new MutationObserver(refresh);
  watcher.observe(document.documentElement, {
    attributes: true,
    attributeFilter: [
      "style",
      "data-background-profile",
      "data-reduced-motion",
    ],
  });
}

function stop() {
  cancelAnimationFrame(frame);
  frame = 0;
  watcher?.disconnect();
  watcher = null;
  motion?.removeEventListener("change", refresh);
  window.removeEventListener("resize", redrawStill);
  window.removeEventListener("scroll", redrawStill, true);
  document.removeEventListener("visibilitychange", refresh);
  resize?.disconnect();
  resize = null;
}

export function ComicHalftone() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const host = canvas?.parentElement;
    if (!canvas || !host) return;
    host.classList.add("comic-halftone-host");
    if (!canvases.size) start();
    canvases.add(canvas);
    resize?.observe(host);
    refresh();
    return () => {
      canvases.delete(canvas);
      resize?.unobserve(host);
      host.classList.remove("comic-halftone-host");
      if (!canvases.size) stop();
    };
  }, []);
  return <canvas ref={ref} className="comic-halftone" aria-hidden="true" />;
}
