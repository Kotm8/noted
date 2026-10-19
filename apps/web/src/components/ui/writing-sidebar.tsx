import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { readStoredValue, writeStoredValue } from "../../lib/storage";

export function WritingSidebar({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const element = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(() => {
    const saved = Number(readStoredValue("noted.writing-width"));
    return Number.isFinite(saved) && saved >= 320 ? Math.min(850, saved) : 420;
  });
  useLayoutEffect(() => {
    const shell = element.current?.closest<HTMLElement>(".app-shell");
    if (!shell) return;
    shell.style.setProperty("--writing-width", `${width}px`);
    const observer = new ResizeObserver(() => {
      shell.dataset.writingOverlay = String(shell.clientWidth < 1050);
    });
    observer.observe(shell);
    return () => {
      observer.disconnect();
      delete shell.dataset.writingOverlay;
    };
  }, [width]);
  function resize(value: number) {
    const shell = element.current?.closest<HTMLElement>(".app-shell");
    const maximum = shell
      ? Math.max(320, Math.min(850, shell.clientWidth - 568))
      : 850;
    const next = Math.max(320, Math.min(maximum, value));
    setWidth(next);
    writeStoredValue("noted.writing-width", String(next));
  }
  return (
    <aside className="writing-sidebar" ref={element} aria-label={title}>
      <div
        className="writing-resizer"
        role="separator"
        aria-label="Resize writing sidebar"
        aria-orientation="vertical"
        aria-valuemin={320}
        aria-valuemax={850}
        aria-valuenow={Math.round(width)}
        tabIndex={0}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          const handle = event.currentTarget;
          const startX = event.clientX;
          const zoom =
            Number.parseFloat(
              getComputedStyle(document.documentElement).zoom,
            ) || 1;
          const initial =
            (element.current?.getBoundingClientRect().width ?? width) / zoom;
          handle.setPointerCapture(event.pointerId);
          const move = (next: PointerEvent) =>
            resize(initial + (startX - next.clientX) / zoom);
          const stop = () => handle.removeEventListener("pointermove", move);
          handle.addEventListener("pointermove", move);
          handle.addEventListener("lostpointercapture", stop, { once: true });
        }}
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
            return;
          event.preventDefault();
          resize(
            event.key === "Home"
              ? 320
              : event.key === "End"
                ? 850
                : width +
                  (event.key === "ArrowLeft" ? 1 : -1) *
                    (event.shiftKey ? 50 : 20),
          );
        }}
      />
      <header className="writing-sidebar-header">
        <h2>{title}</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Close sidebar"
          onClick={onClose}
        >
          <X size={17} />
        </button>
      </header>
      {children}
    </aside>
  );
}
