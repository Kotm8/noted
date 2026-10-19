import { useLayoutEffect, useRef, useState } from "react";

const positions = new Map<string, { top: number; bottom: boolean }>();

export function useTimelineScroll(
  data: unknown,
  followLatest = true,
  positionKey?: string,
) {
  const saved = positionKey ? positions.get(positionKey) : undefined;
  const restore = useRef(saved?.top ?? null);
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const previousHeight = useRef<number | null>(null);
  const stayAtBottom = useRef(saved?.bottom ?? followLatest);
  const [isAtBottom, setIsAtBottom] = useState(saved?.bottom ?? followLatest);
  const hasData = Boolean(data);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      if (stayAtBottom.current && previousHeight.current === null) {
        container.scrollTop = container.scrollHeight;
      }
    });

    observer.observe(container);
    if (contentRef.current) observer.observe(contentRef.current);
    return () => {
      observer.disconnect();
      if (positionKey && hasData) {
        positions.set(positionKey, {
          top: container.scrollTop,
          bottom: stayAtBottom.current,
        });
        if (positions.size > 100)
          positions.delete(positions.keys().next().value!);
      }
    };
  }, [hasData, positionKey]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    if (data && restore.current !== null) {
      container.scrollTop = restore.current;
      restore.current = null;
    } else if (previousHeight.current !== null) {
      container.scrollTop += container.scrollHeight - previousHeight.current;
      previousHeight.current = null;
    } else if (stayAtBottom.current) {
      container.scrollTop = container.scrollHeight;
    }
  }, [data]);

  function handleScroll() {
    const container = containerRef.current;
    if (!container) return;

    const remaining =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    const atBottom = remaining < 100;
    stayAtBottom.current = atBottom;
    setIsAtBottom(atBottom);
  }

  function prepareForOlderNotes() {
    previousHeight.current = containerRef.current?.scrollHeight ?? null;
  }

  function cancelOlderNotes() {
    previousHeight.current = null;
  }

  function followLatestNotes() {
    stayAtBottom.current = true;
  }

  function jumpToLatest() {
    const container = containerRef.current;
    container?.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    stayAtBottom.current = true;
  }

  return {
    containerRef,
    contentRef,
    isAtBottom,
    handleScroll,
    prepareForOlderNotes,
    cancelOlderNotes,
    followLatestNotes,
    jumpToLatest,
  };
}
