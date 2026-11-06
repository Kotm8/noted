import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { copyImage } from "../../../lib/copy-image";

/** Copies the note's text, and its first picture with it when it has one. */
export function CopyNoteButton({
  content,
  imageUrl,
}: {
  content: string;
  imageUrl?: string;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      if (imageUrl) await copyImage(imageUrl, content || undefined);
      else await navigator.clipboard.writeText(content);
      setCopied(true);
    } catch {
      if (imageUrl && content) {
        try {
          await navigator.clipboard.writeText(content);
          setCopied(true);
          toast.error(
            "Copied the text. This browser couldn't copy the picture.",
          );
          return;
        } catch {
          // Falls through to the general message.
        }
      }
      toast.error(
        imageUrl
          ? "Could not copy the picture. Open it and use Copy there."
          : "Could not copy the note. Try selecting and copying its text.",
      );
    }
  }

  const label = imageUrl
    ? content
      ? "Copy text and picture"
      : "Copy picture"
    : "Copy note";
  return (
    <>
      <button
        className="icon-button"
        type="button"
        aria-label={copied ? "Note copied" : label}
        title={
          content || imageUrl ? (copied ? "Copied" : label) : "Nothing to copy"
        }
        disabled={!content && !imageUrl}
        onClick={() => void copy()}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
      <span className="visually-hidden" role="status">
        {copied ? "Note copied" : ""}
      </span>
    </>
  );
}
