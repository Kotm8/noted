import { CalendarDays, House, Inbox, Settings } from "lucide-react";
import { TimeTracker } from "../../time-tracking/components/tracker";
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
  onTrackingSettings: () => void;
  onSchedule: () => void;
  scheduleActive: boolean;
  homeActive: boolean;
  onHome: () => void;
  workspaces: Workspace[];
  onWorkspace: (workspace: Workspace) => void;
  onMissed: () => void;
  trackerRequest: number;
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
  onTrackingSettings,
  onSchedule,
  scheduleActive,
  homeActive,
  onHome,
  workspaces,
  onWorkspace,
  onMissed,
  trackerRequest,
}: ChannelSidebarProps) {
  const { collapsed, toggleCategory } = useCategoryCollapse();
  const updates = useServerUpdates();
  const ungroupedChannels = channels.filter(
    (channel) => channel.category_id === null,
  );
  const isEmpty = !channels.length && !categories.length;
  const selectedChannel = channels.find(
    (channel) => channel.id === selectedChannelId,
  );

  return (
    <aside className="channel-sidebar" aria-label="Channels">
      <div className="workspace-header">
        {homeActive || scheduleActive ? (
          <span className="home-space-name">Your space</span>
        ) : (
          <WorkspaceMenu workspace={workspace} onManage={onManage} />
        )}
      </div>

      <div className="sidebar-global-navigation">
        <button aria-current={homeActive ? "page" : undefined} onClick={onHome}>
          <House size={17} />
          Home
        </button>
        {(homeActive || scheduleActive) && (
          <>
            <button
              aria-current={scheduleActive ? "page" : undefined}
              onClick={onSchedule}
            >
              <CalendarDays size={17} />
              Calendar
            </button>
            <button onClick={onMissed}>
              <Inbox size={17} />
              Missed activity
            </button>
          </>
        )}
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
        {homeActive || scheduleActive ? (
          <div className="home-project-navigation">
            <span className="home-project-label">Projects</span>
            {workspaces.map((item) => (
              <button key={item.id} onClick={() => onWorkspace(item)}>
                <span className="home-project-icon" aria-hidden="true">
                  {item.icon_url ? (
                    <img src={item.icon_url} alt="" />
                  ) : (
                    item.icon
                  )}
                </span>
                {item.name}
              </button>
            ))}
            {!workspaces.length && (
              <Button
                variant="ghost"
                size="small"
                onClick={() => onManage({ kind: "workspace" })}
              >
                Create a project
              </Button>
            )}
          </div>
        ) : isLoading ? (
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
                channels={channels.filter(
                  (channel) => channel.category_id === category.id,
                )}
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

      <div className="sidebar-bottom tracking-sidebar-bottom">
        <TimeTracker
          key={`${new URLSearchParams(window.location.search).get("prompt") ?? "tracker"}:${trackerRequest}`}
          onSettings={onTrackingSettings}
        />
        <button
          className="sidebar-settings"
          aria-label="Settings"
          onClick={onOpenSettings}
        >
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
