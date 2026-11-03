import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Expand,
  ImageOff,
  LoaderCircle,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useAndroidBackLayer } from "../../../lib/android-navigation";
import { formatFileSize } from "../../../lib/format";
import type { Attachment } from "../types";
import { useImageTransform } from "./use-image-transform";
import "./images.css";

export function ImageViewer({
  images,
  initialIndex,
  onClose,
}: {
  images: Attachment[];
  initialIndex: number;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(initialIndex);
  const returnFocus = useRef(document.activeElement);
  useAndroidBackLayer(true, onClose);
  const navigate = (direction: number) =>
    setIndex((value) => (value + direction + images.length) % images.length);
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="image-viewer-overlay" />
        <Dialog.Content
          className="image-viewer"
          aria-describedby="image-viewer-description"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (returnFocus.current instanceof HTMLElement)
              returnFocus.current.focus();
          }}
        >
          <Dialog.Title className="visually-hidden">Image viewer</Dialog.Title>
          <Dialog.Description
            id="image-viewer-description"
            className="visually-hidden"
          >
            Scroll or pinch to zoom. Drag to pan. Arrow keys change images.
            Escape closes the viewer.
          </Dialog.Description>
          <ViewerImage
            key={images[index].id}
            file={images[index]}
            index={index}
            count={images.length}
            navigate={navigate}
            onClose={onClose}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ViewerImage({
  file,
  index,
  count,
  navigate,
  onClose,
}: {
  file: Attachment;
  index: number;
  count: number;
  navigate: (direction: number) => void;
  onClose: () => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [dimensions, setDimensions] = useState({
    width: file.width || 1280,
    height: file.height || 720,
  });
  const view = useImageTransform(
    dimensions.width,
    dimensions.height,
    (direction) => {
      if (count > 1) navigate(direction);
    },
  );
  const original =
    file.original_url ?? `/api/v1/attachments/${file.id}/original`;
  const src = `${original}${attempt ? `?retry=${attempt}` : ""}`;
  useEffect(() => {
    function key(event: KeyboardEvent) {
      if (event.key === "ArrowRight" && count > 1) {
        event.preventDefault();
        navigate(1);
      }
      if (event.key === "ArrowLeft" && count > 1) {
        event.preventDefault();
        navigate(-1);
      }
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [count, navigate]);
  return (
    <>
      <header className="image-viewer-header">
        <div className="image-viewer-file">
          <strong>{file.original_filename}</strong>
          <small>
            {dimensions.width} × {dimensions.height} ·{" "}
            {formatFileSize(file.size)}
            {count > 1 && ` · ${index + 1} of ${count}`}
          </small>
        </div>
        <a
          className="icon-button"
          href={file.download_url}
          download={file.original_filename}
          aria-label="Download original image"
          title="Download original"
        >
          <Download size={19} />
        </a>
        <Dialog.Close className="icon-button" aria-label="Close image viewer">
          <X size={21} />
        </Dialog.Close>
      </header>
      <div
        className={`image-viewer-stage ${view.transform.scale > 1 ? "is-zoomed" : ""}`}
        ref={view.viewport}
        {...view.handlers}
        onClick={() => {
          if (view.background.current && !view.moved.current) onClose();
        }}
      >
        <div
          className="image-viewer-picture"
          style={{
            width: view.image.width,
            height: view.image.height,
            transform: `translate(${view.transform.x}px, ${view.transform.y}px) scale(${view.transform.scale})`,
          }}
        >
          <img
            className="image-viewer-preview"
            src={file.preview_url!}
            alt=""
            aria-hidden="true"
            draggable={false}
          />
          <img
            className={`image-viewer-original ${loaded ? "is-loaded" : ""}`}
            key={src}
            src={src}
            alt={file.original_filename}
            draggable={false}
            onLoad={(event) => {
              const image = event.currentTarget;
              setDimensions({
                width: image.naturalWidth,
                height: image.naturalHeight,
              });
              setLoaded(true);
              setFailed(false);
            }}
            onError={() => setFailed(true)}
          />
        </div>
      </div>
      <footer className="image-viewer-footer">
        <div className="image-viewer-progress" role="status">
          {failed ? (
            <>
              <ImageOff size={15} />
              <span>Couldn't load the original.</span>
              <button
                type="button"
                onClick={() => {
                  setFailed(false);
                  setAttempt((value) => value + 1);
                }}
              >
                Retry
              </button>
            </>
          ) : !loaded ? (
            <>
              <LoaderCircle size={15} className="spin" />
              <span>Loading full quality…</span>
            </>
          ) : (
            <span>Original quality</span>
          )}
        </div>
        <div className="image-viewer-zoom" role="group" aria-label="Image zoom">
          <button
            type="button"
            className="icon-button"
            onClick={view.zoomOut}
            disabled={view.transform.scale <= 1}
            aria-label="Zoom out"
          >
            <ZoomOut size={18} />
          </button>
          <button
            type="button"
            className="image-zoom-value"
            onClick={view.reset}
            title="Fit image"
            aria-label="Fit image"
          >
            {Math.round(view.transform.scale * 100)}%
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={view.zoomIn}
            disabled={view.transform.scale >= 8}
            aria-label="Zoom in"
          >
            <ZoomIn size={18} />
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={view.actual}
            aria-label="Actual image size"
            title="Actual size"
          >
            <Expand size={17} />
          </button>
        </div>
        {count > 1 && (
          <div className="image-viewer-navigation">
            <button
              type="button"
              className="icon-button"
              onClick={() => navigate(-1)}
              aria-label="Previous image"
            >
              <ChevronLeft size={20} />
            </button>
            <span>
              {index + 1} / {count}
            </span>
            <button
              type="button"
              className="icon-button"
              onClick={() => navigate(1)}
              aria-label="Next image"
            >
              <ChevronRight size={20} />
            </button>
          </div>
        )}
      </footer>
    </>
  );
}
