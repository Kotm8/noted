import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";

export function CopyNoteButton({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
    } catch {
      toast.error(
        "Could not copy the note. Try selecting and copying its text.",
      );
    }
  }

  return (
    <>
      <button
        className="icon-button"
        type="button"
        aria-label={copied ? "Note copied" : "Copy note"}
        title={content ? (copied ? "Copied" : "Copy note") : "No text to copy"}
        disabled={!content}
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
