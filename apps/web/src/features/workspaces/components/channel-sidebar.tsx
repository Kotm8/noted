import { Settings } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { useCategoryCollapse } from "../hooks/use-category-collapse";
import type { Category, Channel, OpenManagement, Workspace } from "../types";
import { CategorySection } from "./category-section";
import { ChannelRow } from "./channel-row";
import { WorkspaceMenu } from "./workspace-menu";
import { useServerUpdates } from "../../updates/use-server-updates";

interface ChannelSidebarProps {
  workspace?: Workspace;
  categories: Category[];
  channels: Channel[];
  selectedChannelId?: string;
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void;
  onSelect: (channel: Channel) => void;
  onManage: OpenManagement;
  onOpenSettings: () => void;
}

export function ChannelSidebar({
  workspace,
  categories,
  channels,
  selectedChannelId,
  isLoading,
  error,
  onRetry,
  onSelect,
  onManage,
  onOpenSettings,
}: ChannelSidebarProps) {
  const { collapsed, toggleCategory } = useCategoryCollapse();
  const updates = useServerUpdates();
  const ungroupedChannels = channels.filter((channel) => channel.category_id === null);
  const isEmpty = !channels.length && !categories.length;
  const selectedChannel = channels.find((channel) => channel.id === selectedChannelId);

  return (
    <aside className="channel-sidebar" aria-label="Channels">
      <div className="workspace-header">
        <WorkspaceMenu workspace={workspace} onManage={onManage} />
      </div>

      {selectedChannel?.banner_url && (
        <div className="sidebar-channel-image">
          <img
            src={selectedChannel.banner_url}
            alt={`${selectedChannel.name} channel image`}
            draggable={false}
          />
        </div>
      )}

      <div className="channel-tree">
        {isLoading ? (
          <div className="sidebar-loading" aria-label="Loading channels">
            <span />
            <span />
            <span />
          </div>
        ) : (
          <>
            {ungroupedChannels.map((channel) => (
              <ChannelRow
                key={channel.id}
                channel={channel}
                selected={channel.id === selectedChannelId}
                onSelect={onSelect}
                onManage={onManage}
              />
            ))}
            {categories.map((category) => (
              <CategorySection
                key={category.id}
                category={category}
                channels={channels.filter((channel) => channel.category_id === category.id)}
                selectedChannelId={selectedChannelId}
                collapsed={collapsed.has(category.id)}
                onToggle={() => toggleCategory(category.id)}
                onSelect={onSelect}
                onManage={onManage}
              />
            ))}
            {workspace && isEmpty && (
              <p className="sidebar-empty">Add a channel to start writing.</p>
            )}
          </>
        )}

        {error && (
          <div className="sidebar-error" role="alert">
            Navigation couldn't load.
            <Button size="small" variant="ghost" onClick={onRetry}>
              Retry
            </Button>
          </div>
        )}
      </div>

      <div className="sidebar-bottom">
        <button className="sidebar-settings" aria-label="Settings" onClick={onOpenSettings}>
          <Settings size={18} />
          Settings
          {updates.data?.available && (
            <span className="update-indicator" aria-label="Update available" />
          )}
        </button>
      </div>
    </aside>
  );
}
