/** Browsers only accept PNG images on the clipboard, so other formats are redrawn as PNG. */
async function pngFrom(url: string): Promise<Blob> {
  const response = await fetch(url, { credentials: "same-origin" });
  if (!response.ok) throw new Error("The image couldn't be loaded.");
  const blob = await response.blob();
  if (blob.type === "image/png") return blob;
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
  bitmap.close();
  const png = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  if (!png) throw new Error("The image couldn't be copied.");
  return png;
}

/**
 * Copies an image, with optional text beside it. The clipboard item is created right away
 * with a pending image, because Safari only allows writes during the click itself.
 */
export async function copyImage(url: string, text?: string) {
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write)
    throw new Error("This browser can't copy images.");
  const items: Record<string, Promise<Blob>> = { "image/png": pngFrom(url) };
  if (text)
    items["text/plain"] = Promise.resolve(
      new Blob([text], { type: "text/plain" }),
    );
  await navigator.clipboard.write([new ClipboardItem(items)]);
}
