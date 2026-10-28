import { toast } from "sonner";
import { formatFileSize } from "../../lib/format";
import { plainText } from "../../lib/plain-text";
import type { Attachment, Note } from "./types";

export type ShareContent = "all" | "text" | "files";

/** Files are copied into the phone's memory before sharing, so very large ones are refused. */
const SHARE_LIMIT = 100 * 1024 * 1024;

export function canShare(): boolean {
  return typeof navigator.share === "function";
}

async function fetchFile(
  file: Attachment,
  onProgress: (bytes: number) => void,
) {
  const response = await fetch(file.download_url, { credentials: "include" });
  if (!response.ok || !response.body)
    throw new Error(`Couldn't download ${file.original_filename}.`);
  const reader = response.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    onProgress(value.byteLength);
  }
  return new File(chunks, file.original_filename, {
    type: file.content_type || "application/octet-stream",
  });
}

/**
 * Sends the message's actual text and files to another app through the
 * system share sheet, so the recipient needs no access to this server.
 */
export async function shareNote(note: Note, content: ShareContent) {
  const text = content === "files" ? "" : plainText(note.content);
  const attachments = content === "text" ? [] : note.attachments;
  const total = attachments.reduce((sum, file) => sum + file.size, 0);
  if (total > SHARE_LIMIT) {
    toast.error(
      `These files are ${formatFileSize(total)}. Sharing works up to ${formatFileSize(SHARE_LIMIT)}; use Download instead.`,
    );
    return;
  }
  let files: File[] = [];
  const started = Date.now();
  if (attachments.length) {
    const progress = toast.loading("Preparing files…");
    let received = 0;
    try {
      files = await Promise.all(
        attachments.map((file) =>
          fetchFile(file, (bytes) => {
            received += bytes;
            toast.loading(
              `Preparing files… ${Math.round((received / Math.max(total, 1)) * 100)}%`,
              { id: progress },
            );
          }),
        ),
      );
      toast.dismiss(progress);
    } catch (error) {
      toast.error((error as Error).message, { id: progress });
      return;
    }
    if (!navigator.canShare?.({ files })) {
      toast.error("This device can't share these files. Use Download instead.");
      return;
    }
  }
  const data: ShareData = {
    ...(text ? { text } : {}),
    ...(files.length ? { files } : {}),
  };
  try {
    await navigator.share(data);
  } catch (error) {
    if ((error as Error).name === "AbortError") return;
    // Browsers only open the share sheet shortly after a tap. When the files
    // took a while to fetch, ask for one more tap.
    if (
      (error as Error).name === "NotAllowedError" ||
      Date.now() - started > 4000
    )
      toast("Ready to share", {
        action: { label: "Share", onClick: () => void navigator.share(data) },
        duration: 15000,
      });
    else toast.error("Couldn't open the share menu.");
  }
}

/** Saves each file through the browser, which puts them in the device's Downloads folder. */
export function downloadAttachments(attachments: Attachment[]) {
  attachments.forEach((file, index) =>
    window.setTimeout(() => {
      const link = document.createElement("a");
      link.href = file.download_url;
      link.download = file.original_filename;
      link.rel = "noopener";
      document.body.append(link);
      link.click();
      link.remove();
    }, index * 400),
  );
}
