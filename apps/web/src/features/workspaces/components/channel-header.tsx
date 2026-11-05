import { Menu as MenuIcon, MoreHorizontal, Search } from "lucide-react";
import { Menu, MenuItem } from "../../../components/ui/menu";
import { ChannelIcon } from "./channel-icon";
import type { Channel, OpenManagement, Workspace } from "../types";

interface ChannelHeaderProps {
  workspace?: Workspace;
  channel?: Channel;
  onOpenNavigation: () => void;
  onManage: OpenManagement;
  searchOpen: boolean;
  onOpenSearch: () => void;
  onScheduling: (tab: "messages" | "writing") => void;
}

export function ChannelHeader({
  workspace,
  channel,
  onOpenNavigation,
  onManage,
  searchOpen,
  onOpenSearch,
  onScheduling,
}: ChannelHeaderProps) {
  return (
    <header className="channel-header">
      <button
        className="icon-button mobile-menu"
        aria-label="Open navigation"
        onClick={onOpenNavigation}
      >
        <MenuIcon size={20} />
      </button>
      <div className="channel-heading">
        {channel ? (
          <>
            <ChannelIcon kind={channel.kind} size={21} />
            <h1>{channel.name}</h1>
          </>
        ) : (
          <>
            <h1>{workspace?.name ?? "Noted"}</h1>
          </>
        )}
      </div>

      <div className="header-actions">
        <button
          className="icon-button"
          aria-label="Open search"
          aria-expanded={searchOpen}
          onClick={onOpenSearch}
        >
          <Search size={18} />
        </button>
        {channel && (
          <Menu
            trigger={
              <button className="icon-button" aria-label="Channel options">
                <MoreHorizontal size={21} />
              </button>
            }
          >
            {channel.kind === "note" && (
              <MenuItem onSelect={() => onScheduling("messages")}>
                Scheduled messages
              </MenuItem>
            )}
            <MenuItem onSelect={() => onScheduling("writing")}>
              Writing prompt
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
              Delete channel
            </MenuItem>
          </Menu>
        )}
      </div>
    </header>
  );
}
