import { useEffect, useRef, useState } from "react";

/**
 * Shows an image's first frame until `playing`, so GIFs stay still at rest. The animated
 * image stays mounted and loaded, which lets playback start instantly. Static images look
 * the same either way, so callers don't need to know the file type.
 */
export function StillImage({
  src,
  alt,
  playing,
  loading,
}: {
  src: string;
  alt: string;
  playing: boolean;
  loading?: "lazy" | "eager";
}) {
  const image = useRef<HTMLImageElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [frozen, setFrozen] = useState(false);

  useEffect(() => setFrozen(false), [src]);

  const freeze = () => {
    const img = image.current;
    const target = canvas.current;
    if (!img || !target || !img.naturalWidth) return;
    target.width = img.naturalWidth;
    target.height = img.naturalHeight;
    try {
      target.getContext("2d")?.drawImage(img, 0, 0);
      setFrozen(true);
    } catch {
      setFrozen(false);
    }
  };

  const still = frozen && !playing;
  return (
    <>
      <img
        ref={image}
        src={src}
        alt={alt}
        loading={loading}
        onLoad={freeze}
        hidden={still}
      />
      <canvas
        ref={canvas}
        {...(alt ? { role: "img", "aria-label": alt } : { "aria-hidden": true })}
        hidden={!still}
      />
    </>
  );
}
