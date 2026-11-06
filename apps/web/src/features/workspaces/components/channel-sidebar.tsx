import { useState } from "react";
import {
  Apple,
  CalendarDays,
  House,
  Settings,
  CheckSquare,
} from "lucide-react";
import { useHomeActivity } from "../../home/use-home-activity";
import { useAllChannels } from "../hooks/use-all-channels";
import { ChannelIcon } from "./channel-icon";
import { StillImage } from "../../../components/ui/still-image";
import { useNutritionEnabled } from "../../ai/queries";
import { TimeTracker } from "../../time-tracking/components/tracker";
import { Button } from "../../../components/ui/button";
import { useCategoryCollapse } from "../hooks/use-category-collapse";
import type { Category, Channel, OpenManagement, Workspace } from "../types";
import { CategorySection } from "./category-section";
import { ChannelRow } from "./channel-row";
import { WorkspaceMenu } from "./workspace-menu";
import { useServerUpdates } from "../../updates/use-server-updates";
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
  onOpenSettings: () => void;
  onTrackingSettings: () => void;
  onSchedule: () => void;
  scheduleActive: boolean;
  habitsActive: boolean;
  onHabits: () => void;
  nutritionActive: boolean;
  onNutrition: () => void;
  homeActive: boolean;
  onHome: () => void;
  workspaces: Workspace[];
  onWorkspace: (workspace: Workspace) => void;
  trackerRequest: number;
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
  onOpenSettings,
  onTrackingSettings,
  onSchedule,
  scheduleActive,
  habitsActive,
  onHabits,
  nutritionActive,
  onNutrition,
  homeActive,
  onHome,
  workspaces,
  onWorkspace,
  trackerRequest,
}: ChannelSidebarProps) {
  const { collapsed, toggleCategory } = useCategoryCollapse();
  const updates = useServerUpdates();
  const reorder = useSidebarReorder(workspace?.id, { categories, channels });
  const ungroupedChannels = channels.filter(
    (channel) => channel.category_id === null,
  );
  const isEmpty = !channels.length && !categories.length;
  const nutritionEnabled = useNutritionEnabled();
  const [hoveredProject, setHoveredProject] = useState<string | null>(null);
  const waiting = (useHomeActivity(50).query.data?.items ?? []).filter(
    (item) => !item.read,
  ).length;
  const allChannels = useAllChannels();
  const pinned = (allChannels ?? [])
    .filter((channel) => channel.pinned_at)
    .sort((a, b) => a.pinned_at!.localeCompare(b.pinned_at!));

  return (
    <aside className="channel-sidebar" aria-label="Channels">
      <div className="workspace-header">
        {homeActive || scheduleActive || habitsActive || nutritionActive ? (
          <span className="home-space-name">Your space</span>
        ) : (
          <WorkspaceMenu workspace={workspace} onManage={onManage} />
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
      </div>

      <div
        className="channel-tree"
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            reorder.clearMarker();
        }}
      >
        {homeActive || scheduleActive || habitsActive || nutritionActive ? (
          <div className="home-project-navigation">
            <span className="home-project-label">Projects</span>
            {workspaces.map((item) => (
              <button
                key={item.id}
                onClick={() => onWorkspace(item)}
                onPointerEnter={(event) => {
                  if (event.pointerType === "mouse") setHoveredProject(item.id);
                }}
                onPointerLeave={() => setHoveredProject(null)}
              >
                <span className="home-project-icon" aria-hidden="true">
                  {item.icon_url ? (
                    <StillImage
                      src={item.icon_url}
                      alt=""
                      playing={hoveredProject === item.id}
                    />
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
            {pinned.length > 0 && (
              <>
                <span className="home-project-label">Pinned</span>
                {pinned.map((channel) => (
                  <button
                    key={channel.id}
                    className="sidebar-pinned"
                    onClick={() => onSelect(channel)}
                  >
                    <ChannelIcon kind={channel.kind} size={15} />
                    <span>{channel.name}</span>
                    <small>
                      {workspaces.find(
                        (item) => item.id === channel.workspace_id,
                      )?.name ?? ""}
                    </small>
                  </button>
                ))}
              </>
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
