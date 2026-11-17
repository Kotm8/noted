import { MoreHorizontal } from "lucide-react";
import { ChannelIcon } from "./channel-icon";
import { ChannelActions } from "./channel-actions";
import { ContextMenu } from "../../../components/ui/context-menu";
import { Menu } from "../../../components/ui/menu";
import type { Channel, OpenManagement } from "../types";
import type { SidebarReorder } from "../hooks/use-sidebar-reorder";

interface ChannelRowProps {
  channel: Channel;
  selected: boolean;
  pending?: boolean;
  onSelect: (channel: Channel) => void;
  onManage: OpenManagement;
  reorder: SidebarReorder;
}

export function ChannelRow({
  channel,
  selected,
  pending,
  onSelect,
  onManage,
  reorder,
}: ChannelRowProps) {
  return (
    <ContextMenu
      label={`Actions for channel ${channel.name}`}
      menu={<ChannelActions channel={channel} onManage={onManage} />}
    >
      <div
        className={`channel-row ${selected ? "channel-active" : ""}`}
        data-channel-id={channel.id}
        {...reorder.channelProps(channel)}
      >
        <button
          className="channel-link"
          onClick={() => onSelect(channel)}
          aria-current={selected ? "page" : undefined}
          aria-busy={pending || undefined}
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
          <ChannelActions channel={channel} onManage={onManage} />
        </Menu>
      </div>
    </ContextMenu>
  );
}
