import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { ChannelIcon } from "./channel-icon";
import { Menu, MenuItem } from "../../../components/ui/menu";
import type { Channel, OpenManagement } from "../types";

interface ChannelRowProps {
  channel: Channel;
  selected: boolean;
  onSelect: (channel: Channel) => void;
  onManage: OpenManagement;
}

export function ChannelRow({
  channel,
  selected,
  onSelect,
  onManage,
}: ChannelRowProps) {
  return (
    <div className={`channel-row ${selected ? "channel-active" : ""}`}>
      <button
        className="channel-link"
        onClick={() => onSelect(channel)}
        aria-current={selected ? "page" : undefined}
      >
        <ChannelIcon kind={channel.kind} size={18} />
        <span>{channel.name}</span>
      </button>

      <Menu
        trigger={
          <button
            className="channel-options icon-button"
            aria-label={`Options for ${channel.name}`}
          >
            <MoreHorizontal size={15} />
          </button>
        }
      >
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
      </Menu>
    </div>
  );
}
