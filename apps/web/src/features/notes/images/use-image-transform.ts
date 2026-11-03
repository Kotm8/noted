import { useEffect, useRef, useState, type PointerEvent } from "react";

type Point = { x: number; y: number };
type Transform = Point & { scale: number };
const initial: Transform = { scale: 1, x: 0, y: 0 };
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const midpoint = (a: Point, b: Point) => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
});

export function useImageTransform(
  width: number,
  height: number,
  onSwipe: (direction: number) => void,
) {
  const viewport = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState({ width: 1, height: 1 });
  const [transform, setTransform] = useState(initial);
  const pointers = useRef(new Map<number, Point>());
  const pinch = useRef<{ distance: number; center: Point } | null>(null);
  const start = useRef<Point | null>(null);
  const multiple = useRef(false);
  const moved = useRef(false);
  const background = useRef(false);
  const fit = Math.min(
    (bounds.width - 48) / width,
    (bounds.height - 48) / height,
    1,
  );
  const image = {
    width: Math.max(1, width * fit),
    height: Math.max(1, height * fit),
  };

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      setBounds({ width: element.clientWidth, height: element.clientHeight });
      setTransform(initial);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  function clamp(next: Transform): Transform {
    const x = Math.max(0, (image.width * next.scale - bounds.width + 32) / 2);
    const y = Math.max(0, (image.height * next.scale - bounds.height + 32) / 2);
    return {
      scale: next.scale,
      x: Math.max(-x, Math.min(x, next.x)),
      y: Math.max(-y, Math.min(y, next.y)),
    };
  }
  function zoom(scale: number, anchor: Point = { x: 0, y: 0 }) {
    setTransform((previous) => {
      scale = Math.max(1, Math.min(8, scale));
      const ratio = scale / previous.scale;
      return clamp({
        scale,
        x: anchor.x - (anchor.x - previous.x) * ratio,
        y: anchor.y - (anchor.y - previous.y) * ratio,
      });
    });
  }

  const wheel = useRef<(event: WheelEvent) => void>(() => undefined);
  wheel.current = (event) => {
    event.preventDefault();
    const rect = viewport.current!.getBoundingClientRect();
    zoom(transform.scale * Math.exp(-event.deltaY * 0.002), {
      x: event.clientX - rect.left - rect.width / 2,
      y: event.clientY - rect.top - rect.height / 2,
    });
  };
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const listener = (event: WheelEvent) => wheel.current(event);
    element.addEventListener("wheel", listener, { passive: false });
    return () => element.removeEventListener("wheel", listener);
  }, []);

  function point(event: PointerEvent): Point {
    return { x: event.clientX, y: event.clientY };
  }
  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    background.current = event.target === event.currentTarget;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, point(event));
    if (pointers.current.size === 1) {
      start.current = point(event);
      moved.current = false;
      multiple.current = false;
    }
    if (pointers.current.size === 2) {
      multiple.current = true;
      const [a, b] = [...pointers.current.values()];
      pinch.current = { distance: distance(a, b), center: midpoint(a, b) };
    }
  }
  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    const next = point(event);
    pointers.current.set(event.pointerId, next);
    if (start.current && distance(start.current, next) > 5)
      moved.current = true;
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const center = midpoint(a, b);
      const span = distance(a, b);
      const rect = viewport.current!.getBoundingClientRect();
      zoom((transform.scale * span) / Math.max(1, pinch.current.distance), {
        x: center.x - rect.left - rect.width / 2,
        y: center.y - rect.top - rect.height / 2,
      });
      pinch.current = { distance: span, center };
    } else if (transform.scale > 1) {
      setTransform((value) =>
        clamp({
          ...value,
          x: value.x + next.x - previous.x,
          y: value.y + next.y - previous.y,
        }),
      );
    }
  }
  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    if (
      event.type === "pointerup" &&
      !multiple.current &&
      start.current &&
      transform.scale === 1
    ) {
      const dx = event.clientX - start.current.x;
      const dy = event.clientY - start.current.y;
      if (Math.abs(dx) > 65 && Math.abs(dx) > Math.abs(dy) * 1.4)
        onSwipe(dx < 0 ? 1 : -1);
    }
    pointers.current.delete(event.pointerId);
    pinch.current = null;
    if (!pointers.current.size) start.current = null;
  }
  return {
    viewport,
    image,
    transform,
    moved,
    background,
    zoomIn: () => zoom(transform.scale * 1.5),
    zoomOut: () => zoom(transform.scale / 1.5),
    reset: () => setTransform(initial),
    actual: () => zoom(1 / Math.max(0.001, fit)),
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
      onLostPointerCapture: onPointerUp,
      onDoubleClick: () =>
        transform.scale > 1 ? setTransform(initial) : zoom(2),
    },
  };
}
