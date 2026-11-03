import { useRef, useState, type MouseEvent, type PointerEvent } from "react";

/** Hover plays on a mouse; a tap toggles on touch, since touch has no hover. */
export function usePlayOnHover() {
  const [playing, setPlaying] = useState(false);
  const touch = useRef(false);
  return {
    playing,
    handlers: {
      onPointerEnter: (event: PointerEvent) => {
        touch.current = event.pointerType !== "mouse";
        if (!touch.current) setPlaying(true);
      },
      onPointerLeave: (event: PointerEvent) => {
        if (event.pointerType === "mouse") setPlaying(false);
      },
    },
    toggleOnTouch: (event: MouseEvent) => {
      if (!touch.current) return;
      event.preventDefault();
      setPlaying((value) => !value);
    },
  };
}
