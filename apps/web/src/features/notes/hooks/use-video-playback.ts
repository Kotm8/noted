import { useEffect, useRef, useState } from "react";

const VIDEO_PLAY_EVENT = "noted:video-play";

export function useVideoPlayback() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);
  const [started, setStarted] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    const frame = frameRef.current;
    if (!video || !frame) return;

    function pause() {
      if (document.pictureInPictureElement !== video) video?.pause();
    }

    function pauseOther(event: Event) {
      if ((event as CustomEvent<HTMLVideoElement>).detail !== video) video?.pause();
    }

    function onVisibilityChange() {
      if (document.hidden) pause();
    }

    const loader = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setActive(true);
          loader.disconnect();
        }
      },
      { rootMargin: "160px" },
    );
    const visibility = new IntersectionObserver((entries) => {
      if (
        entries.every((entry) => !entry.isIntersecting) &&
        !document.fullscreenElement?.contains(video)
      ) {
        pause();
      }
    });
    loader.observe(frame);
    visibility.observe(frame);
    window.addEventListener(VIDEO_PLAY_EVENT, pauseOther);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      loader.disconnect();
      visibility.disconnect();
      window.removeEventListener(VIDEO_PLAY_EVENT, pauseOther);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      video.pause();
    };
  }, []);

  function onPlay() {
    setStarted(true);
    window.dispatchEvent(new CustomEvent(VIDEO_PLAY_EVENT, { detail: videoRef.current }));
  }

  async function play(retry = false) {
    const video = videoRef.current;
    if (!video) return;
    setFailed(false);
    if (retry) video.load();
    try {
      await video.play();
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setFailed(true);
      setBuffering(false);
    }
  }

  return {
    videoRef,
    frameRef,
    active,
    started,
    buffering,
    failed,
    play,
    onPlay,
    onPlaying: () => setBuffering(false),
    onWaiting: () => setBuffering(true),
    onPause: () => setBuffering(false),
    onError: () => {
      setFailed(true);
      setBuffering(false);
    },
  };
}
