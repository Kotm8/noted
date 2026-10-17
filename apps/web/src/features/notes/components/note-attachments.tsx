import { Download, FileText } from "lucide-react";
import { formatFileSize } from "../../../lib/format";
import type { Attachment } from "../types";
import { VideoAttachment } from "./video-attachment";

export function NoteAttachments({ attachments }: { attachments: Attachment[] }) {
  if (!attachments.length) return null;
  return (
    <div className="note-attachments">
      {attachments.map((file) =>
        file.playback_url ? (
          <VideoAttachment file={file} key={file.id} />
        ) : file.preview_url ? (
          <a
            className="image-attachment"
            key={file.id}
            href={file.download_url}
            download={file.original_filename}
            title={`Download ${file.original_filename}`}
          >
            <img src={file.preview_url} alt={file.original_filename} loading="lazy" />
          </a>
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
    </div>
  );
}
