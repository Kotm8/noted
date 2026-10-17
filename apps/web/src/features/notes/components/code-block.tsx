import { useState, type ComponentPropsWithoutRef } from "react";
import { Check, Copy } from "lucide-react";

export function CodeBlock({ children, ...props }: ComponentPropsWithoutRef<"pre">) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  async function copyCode(button: HTMLButtonElement) {
    const content = button.parentElement?.querySelector("code")?.textContent ?? "";

    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setFailed(false);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setFailed(true);
    }
  }

  return (
    <div className="code-block">
      <button
        className="code-copy"
        aria-label="Copy code"
        onClick={(event) => void copyCode(event.currentTarget)}
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
        {copied ? "Copied" : failed ? "Copy failed" : "Copy"}
      </button>
      <pre {...props}>{children}</pre>
    </div>
  );
}
