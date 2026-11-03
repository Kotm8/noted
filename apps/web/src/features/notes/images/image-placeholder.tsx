import { ImageIcon } from "lucide-react";

export function ImagePlaceholder() {
  return (
    <span
      className="image-placeholder"
      role="status"
      aria-label="Loading image"
    >
      <ImageIcon size={23} aria-hidden="true" />
    </span>
  );
}
