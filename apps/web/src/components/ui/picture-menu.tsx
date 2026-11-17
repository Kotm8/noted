import type { ReactElement } from "react";
import { Copy, Download } from "lucide-react";
import { copyPicture } from "../../lib/clipboard";
import { ContextMenu } from "./context-menu";
import { MenuItem } from "./menu";

export function PictureMenu({
  url,
  children,
  name = "image",
}: {
  url: string;
  children: ReactElement;
  name?: string;
}) {
  function download() {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  }
  return (
    <ContextMenu
      label="Image actions"
      menu={
        <>
          <MenuItem onSelect={() => void copyPicture(url)}>
            <Copy size={14} />
            Copy image
          </MenuItem>
          <MenuItem onSelect={download}>
            <Download size={14} />
            Download image
          </MenuItem>
        </>
      }
    >
      {children}
    </ContextMenu>
  );
}
