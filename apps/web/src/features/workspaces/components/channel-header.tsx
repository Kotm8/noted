import {
  Bell,
  Hash,
  Menu as MenuIcon,
  MoreHorizontal,
  Search,
} from "lucide-react";
import { Menu, MenuItem } from "../../../components/ui/menu";
import type { Channel, OpenManagement, Workspace } from "../types";

interface ChannelHeaderProps {
  workspace?: Workspace;
  channel?: Channel;
  onOpenNavigation: () => void;
  onManage: OpenManagement;
  searchOpen: boolean;
  onOpenSearch: () => void;
}

export function ChannelHeader({
  workspace,
  channel,
  onOpenNavigation,
  onManage,
  searchOpen,
  onOpenSearch,
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
            {channel.kind === "reminder" ? (
              <Bell size={21} strokeWidth={1.75} />
            ) : (
              <Hash size={21} strokeWidth={1.6} />
            )}
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
