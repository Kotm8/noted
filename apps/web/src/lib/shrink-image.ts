const MAX_EDGE = 2048;

/**
 * Phone photos are often 5–15 MB and over 16 megapixels, more than the server accepts for
 * meal and assistant pictures, which it shrinks to 1280px anyway. Shrinking on the device
 * first keeps uploads small on mobile data and turns HEIC into JPEG where the browser can
 * decode it. Files that can't be decoded are sent as they are, so the server's own checks
 * still explain what's wrong.
 */
export async function shrinkImage(file: File): Promise<File> {
  if (file.type === "image/gif") return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return file;
  }
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  if (
    scale === 1 &&
    file.size < 1.5 * 1024 * 1024 &&
    file.type !== "image/heic"
  ) {
    bitmap.close();
    return file;
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.86),
  );
  if (!blob) return file;
  const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
  return new File([blob], name, { type: "image/jpeg" });
}
