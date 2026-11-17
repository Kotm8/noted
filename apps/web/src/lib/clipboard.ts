import { toast } from "sonner";
import { copyImage } from "./copy-image";

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Copied");
  } catch {
    toast.error("Could not copy. Select the text and use Copy.");
  }
}

export async function copyPicture(url: string) {
  try {
    await copyImage(url);
    toast.success("Image copied");
  } catch {
    toast.error("Could not copy the image. Download the original instead.");
  }
}
