import type { ReactElement } from "react";
import { Copy, Download, Expand } from "lucide-react";
import { ContextMenu } from "../../../components/ui/context-menu";
import { MenuItem } from "../../../components/ui/menu";
import { copyPicture } from "../../../lib/clipboard";
import { downloadAttachments } from "../share";
import type { Attachment } from "../types";

export function AttachmentMenu({
  file,
  children,
  onOpen,
}: {
  file: Attachment;
  children: ReactElement;
  onOpen?: () => void;
}) {
  const picture = file.content_type.startsWith("image/");
  return (
    <ContextMenu
      label={`Actions for ${file.original_filename}`}
      menu={
        <>
          {onOpen && (
            <MenuItem onSelect={onOpen}>
              <Expand size={14} />
              Open image
            </MenuItem>
          )}
          {picture && (
            <MenuItem
              onSelect={() =>
                void copyPicture(
                  file.original_url ??
                    `/api/v1/attachments/${file.id}/original`,
                )
              }
            >
              <Copy size={14} />
              Copy image
            </MenuItem>
          )}
          <MenuItem onSelect={() => downloadAttachments([file])}>
            <Download size={14} />
            Download original
          </MenuItem>
        </>
      }
    >
      {children}
    </ContextMenu>
  );
}
