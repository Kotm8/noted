import { useLayoutEffect, useRef, useState } from "react";

export function useTimelineScroll(data: unknown, followLatest = true) {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const previousHeight = useRef<number | null>(null);
  const stayAtBottom = useRef(followLatest);
  const [isAtBottom, setIsAtBottom] = useState(followLatest);

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
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    if (previousHeight.current !== null) {
      container.scrollTop += container.scrollHeight - previousHeight.current;
      previousHeight.current = null;
    } else if (stayAtBottom.current) {
      container.scrollTop = container.scrollHeight;
    }
  }, [data]);

  function handleScroll() {
    const container = containerRef.current;
    if (!container) return;

    const remaining = container.scrollHeight - container.scrollTop - container.clientHeight;
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
