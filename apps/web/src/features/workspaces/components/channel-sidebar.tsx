import { ContextMenu } from "../../../components/ui/context-menu";
import { MenuItem } from "../../../components/ui/menu";
import { WorkspaceActions } from "./workspace-menu";
import { ChannelActions } from "./channel-actions";
import { ComicHalftone } from "../../../components/ui/comic-halftone";
import {
  Apple,
  CalendarDays,
  House,
  CheckSquare,
  Pin,
  Wallet,
} from "lucide-react";
import { useHomeActivity } from "../../home/use-home-activity";
import { useAllChannels } from "../hooks/use-all-channels";
import { useNutritionEnabled } from "../../ai/queries";
import { TimeTracker } from "../../time-tracking/components/tracker";
import { Button } from "../../../components/ui/button";
import { useCategoryCollapse } from "../hooks/use-category-collapse";
import type { Category, Channel, OpenManagement, Workspace } from "../types";
import { CategorySection } from "./category-section";
import { ChannelRow } from "./channel-row";
import { WorkspaceMenu } from "./workspace-menu";
import { useSidebarReorder } from "../hooks/use-sidebar-reorder";

interface ChannelSidebarProps {
  workspace?: Workspace;
  categories: Category[];
  channels: Channel[];
  selectedChannelId?: string;
  pendingChannelId?: string;
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void;
  onSelect: (channel: Channel) => void;
  onManage: OpenManagement;
  onTrackingSettings: () => void;
  onSchedule: () => void;
  scheduleActive: boolean;
  habitsActive: boolean;
  onHabits: () => void;
  nutritionActive: boolean;
  onNutrition: () => void;
  financeActive?: boolean;
  onFinance?: () => void;
  homeActive: boolean;
  onHome: () => void;
  workspaces: Workspace[];
  trackerRequest: number;
  hideTracker?: boolean;
}

export function ChannelSidebar({
  workspace,
  categories,
  channels,
  selectedChannelId,
  pendingChannelId,
  isLoading,
  error,
  onRetry,
  onSelect,
  onManage,
  onTrackingSettings,
  onSchedule,
  scheduleActive,
  habitsActive,
  onHabits,
  nutritionActive,
  onNutrition,
  financeActive,
  onFinance,
  homeActive,
  onHome,
  workspaces,
  trackerRequest,
  hideTracker,
}: ChannelSidebarProps) {
  const { collapsed, toggleCategory } = useCategoryCollapse();
  const reorder = useSidebarReorder(workspace?.id, { categories, channels });
  const ungroupedChannels = channels.filter(
    (channel) => channel.category_id === null,
  );
  const isEmpty = !channels.length && !categories.length;
  const nutritionEnabled = useNutritionEnabled();
  const waiting = (useHomeActivity(50).query.data?.items ?? []).filter(
    (item) => !item.read,
  ).length;
  const allChannels = useAllChannels();
  const pinned = (allChannels ?? [])
    .filter((channel) => channel.pinned_at)
    .sort((a, b) => a.pinned_at!.localeCompare(b.pinned_at!));

  return (
    <aside className="channel-sidebar" aria-label="Channels">
      <ComicHalftone />
      <div className="workspace-header">
        {workspace ? (
          <WorkspaceMenu workspace={workspace} onManage={onManage} />
        ) : (
          <span className="home-space-name">Your space</span>
        )}
      </div>

      <div className="sidebar-global-navigation">
        <button aria-current={homeActive ? "page" : undefined} onClick={onHome}>
          <House size={17} />
          Home
          {waiting > 0 && (
            <span
              className="sidebar-count"
              aria-label={`${waiting} waiting on Home`}
              title="Waiting on Home"
            >
              {waiting}
            </span>
          )}
        </button>
        <button
          aria-current={scheduleActive ? "page" : undefined}
          onClick={onSchedule}
        >
          <CalendarDays size={17} />
          Calendar
        </button>
        <button
          aria-current={habitsActive ? "page" : undefined}
          onClick={onHabits}
        >
          <CheckSquare size={17} />
          Habits
        </button>
        {(nutritionEnabled || nutritionActive) && (
          <button
            aria-current={nutritionActive ? "page" : undefined}
            onClick={onNutrition}
          >
            <Apple size={17} />
            Nutrition
          </button>
        )}
        <button
          aria-current={financeActive ? "page" : undefined}
          onClick={onFinance}
        >
          <Wallet size={17} />
          Finance
        </button>
      </div>

      <ContextMenu
        label="Navigation actions"
        menu={
          workspace ? (
            <WorkspaceActions workspace={workspace} onManage={onManage} />
          ) : (
            <MenuItem onSelect={() => onManage({ kind: "workspace" })}>
              Create project
            </MenuItem>
          )
        }
      >
        <div
          className="channel-tree"
          onDragLeave={(event) => {
            if (
              !event.currentTarget.contains(event.relatedTarget as Node | null)
            )
              reorder.clearMarker();
          }}
        >
          {pinned.length > 0 && (
            <section className="sidebar-pins" aria-label="Pinned channels">
              <div className="sidebar-tree-label">Pinned</div>
              {pinned.map((channel) => (
                <ContextMenu
                  key={channel.id}
                  label={`Actions for channel ${channel.name}`}
                  menu={
                    <ChannelActions channel={channel} onManage={onManage} />
                  }
                >
                  <button
                    className="sidebar-pinned"
                    onClick={() => onSelect(channel)}
                  >
                    <Pin size={14} />
                    <span>{channel.name}</span>
                    {channel.workspace_id !== workspace?.id && (
                      <small>
                        {
                          workspaces.find(
                            (item) => item.id === channel.workspace_id,
                          )?.name
                        }
                      </small>
                    )}
                  </button>
                </ContextMenu>
              ))}
            </section>
          )}
          {workspace && <div className="sidebar-tree-label">Channels</div>}
          {isLoading ? (
            <div className="sidebar-loading" aria-label="Loading channels">
              <span />
              <span />
              <span />
            </div>
          ) : (
            <>
              <div className="ungrouped-channels" {...reorder.ungroupedProps}>
                {ungroupedChannels.map((channel) => (
                  <ChannelRow
                    key={channel.id}
                    channel={channel}
                    selected={channel.id === selectedChannelId}
                    pending={channel.id === pendingChannelId}
                    onSelect={onSelect}
                    onManage={onManage}
                    reorder={reorder}
                  />
                ))}
                {reorder.draggingChannel && !ungroupedChannels.length && (
                  <span className="sidebar-drop-placeholder">
                    Move outside categories
                  </span>
                )}
              </div>
              {categories.map((category) => (
                <CategorySection
                  key={category.id}
                  category={category}
                  channels={channels.filter(
                    (channel) => channel.category_id === category.id,
                  )}
                  selectedChannelId={selectedChannelId}
                  pendingChannelId={pendingChannelId}
                  collapsed={collapsed.has(category.id)}
                  onToggle={() => toggleCategory(category.id)}
                  onSelect={onSelect}
                  onManage={onManage}
                  reorder={reorder}
                />
              ))}
              {workspace && isEmpty && (
                <p className="sidebar-empty">Add a channel to start writing.</p>
              )}
              {!workspace && !workspaces.length && (
                <Button
                  variant="ghost"
                  size="small"
                  onClick={() => onManage({ kind: "workspace" })}
                >
                  Create a project
                </Button>
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
      </ContextMenu>

      {!hideTracker && (
        <div className="sidebar-bottom tracking-sidebar-bottom">
          <TimeTracker
            key={`${new URLSearchParams(window.location.search).get("prompt") ?? "tracker"}:${trackerRequest}`}
            onSettings={onTrackingSettings}
          />
        </div>
      )}
    </aside>
  );
}
