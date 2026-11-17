import { Pencil, Trash2 } from "lucide-react";
import { MenuItem } from "../../../components/ui/menu";
import { ChannelPinItem } from "./channel-pin-item";
import type { Channel, OpenManagement } from "../types";

export function ChannelActions({
  channel,
  onManage,
}: {
  channel: Channel;
  onManage: OpenManagement;
}) {
  return (
    <>
      <ChannelPinItem channel={channel} />
      <MenuItem
        onSelect={() =>
          onManage({
            kind: "channel",
            workspaceId: channel.workspace_id,
            categoryId: channel.category_id ?? undefined,
          })
        }
      >
        Create channel
      </MenuItem>
      <MenuItem
        onSelect={() =>
          onManage({ kind: "category", workspaceId: channel.workspace_id })
        }
      >
        Create category
      </MenuItem>
      <MenuItem
        onSelect={() =>
          onManage({
            kind: "channel",
            workspaceId: channel.workspace_id,
            item: channel,
          })
        }
      >
        <Pencil size={14} />
        Edit channel
      </MenuItem>
      <MenuItem
        danger
        onSelect={() =>
          onManage({
            kind: "channel",
            workspaceId: channel.workspace_id,
            item: channel,
            deleting: true,
          })
        }
      >
        <Trash2 size={14} />
        Delete channel
      </MenuItem>
    </>
  );
}
