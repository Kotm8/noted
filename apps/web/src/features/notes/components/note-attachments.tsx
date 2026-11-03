import { Download, FileText } from "lucide-react";
import { useState } from "react";
import { ImageThumbnail } from "../images/image-thumbnail";
import { ImageViewer } from "../images/image-viewer";
import { formatFileSize } from "../../../lib/format";
import type { Attachment } from "../types";
import { VideoAttachment } from "./video-attachment";

export function NoteAttachments({
  attachments,
}: {
  attachments: Attachment[];
}) {
  const [viewing, setViewing] = useState<number | null>(null);
  const images = attachments.filter((file) => file.preview_url);
  if (!attachments.length) return null;
  return (
    <div className="note-attachments">
      {attachments.map((file) =>
        file.playback_url ? (
          <VideoAttachment file={file} key={file.id} />
        ) : file.preview_url ? (
          <ImageThumbnail
            file={file}
            key={file.id}
            onOpen={() =>
              setViewing(images.findIndex((image) => image.id === file.id))
            }
          />
        ) : (
          <a
            className="file-attachment"
            key={file.id}
            href={file.download_url}
            download={file.original_filename}
          >
            <FileText size={23} />
            <span>
              <strong>{file.original_filename}</strong>
              <small>{formatFileSize(file.size)}</small>
            </span>
            <Download size={16} />
          </a>
        ),
      )}
      {viewing !== null && (
        <ImageViewer
          images={images}
          initialIndex={viewing}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}
