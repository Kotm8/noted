import { useState, type CSSProperties } from "react";
import { ImageOff, RotateCw } from "lucide-react";
import type { Attachment } from "../types";
import { ImagePlaceholder } from "./image-placeholder";
import "./images.css";

export function ImageThumbnail({
  file,
  onOpen,
}: {
  file: Attachment;
  onOpen: () => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const width = file.width || 480;
  const height = file.height || 270;
  const displayWidth = Math.min(480, width, (360 * width) / height);
  const src = `${file.preview_url}${attempt ? `${file.preview_url!.includes("?") ? "&" : "?"}retry=${attempt}` : ""}`;
  return (
    <div
      className="image-attachment"
      style={
        {
          width: `min(${displayWidth}px, 100%)`,
          aspectRatio: `${width} / ${height}`,
        } as CSSProperties
      }
    >
      <button
        type="button"
        className="image-open"
        aria-label={`Open image ${file.original_filename}`}
        onClick={onOpen}
        disabled={failed}
        aria-busy={!loaded && !failed}
      >
        <img
          key={src}
          src={src}
          alt={file.original_filename}
          loading="lazy"
          decoding="async"
          className={loaded ? "is-loaded" : ""}
          onLoad={() => {
            setLoaded(true);
            setFailed(false);
          }}
          onError={() => setFailed(true)}
        />
        {!loaded && !failed && <ImagePlaceholder />}
      </button>
      {failed && (
        <div className="image-load-error" role="status">
          <ImageOff size={20} />
          <span>Couldn't load image</span>
          <button
            type="button"
            onClick={() => {
              setFailed(false);
              setLoaded(false);
              setAttempt((value) => value + 1);
            }}
          >
            <RotateCw size={13} />
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
