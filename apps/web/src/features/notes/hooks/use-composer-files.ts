import { useState } from "react";
import { toast } from "sonner";

export function useComposerFiles() {
  const [files, setFiles] = useState<File[]>([]);
  function addFiles(incoming: File[]) {
    const next = [...files, ...incoming];
    if (
      next.length > 10 ||
      next.some((file) => file.size > 250 * 1024 * 1024) ||
      next.reduce((size, file) => size + file.size, 0) > 500 * 1024 * 1024
    ) {
      toast.error("Choose up to 10 files, 250 MB each and 500 MB total.");
      return;
    }
    setFiles(next);
  }
  return { files, setFiles, addFiles };
}
