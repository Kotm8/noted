import { useEffect, useState } from "react";
import { FileText, X } from "lucide-react";
import { formatFileSize } from "../../../lib/format";

function PendingPreview({ file }: { file: File }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file.type.startsWith("image/")) return;
    const created = URL.createObjectURL(file);
    setUrl(created);
    return () => URL.revokeObjectURL(created);
  }, [file]);
  if (!url) return <FileText size={18} />;
  return (
    <img
      className="pending-file-preview"
      src={url}
      alt=""
      onError={() => setUrl(null)}
    />
  );
}

export function PendingFiles({
  files,
  disabled,
  onRemove,
}: {
  files: File[];
  disabled: boolean;
  onRemove: (index: number) => void;
}) {
  if (!files.length) return null;
  return (
    <div className="pending-files">
      {files.map((file, index) => (
        <div className="pending-file" key={`${file.name}-${index}`}>
          <PendingPreview file={file} />
          <span>
            <strong>{file.name}</strong>
            <small>{formatFileSize(file.size)}</small>
          </span>
          <button
            type="button"
            className="icon-button"
            aria-label={`Remove ${file.name}`}
            disabled={disabled}
            onClick={() => onRemove(index)}
          >
            <X size={15} />
          </button>
        </div>
      ))}
    </div>
  );
}
