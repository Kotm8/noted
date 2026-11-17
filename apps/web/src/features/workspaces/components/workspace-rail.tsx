import { ComicHalftone } from "../../../components/ui/comic-halftone";
import { useState } from "react";
import { Plus, Settings } from "lucide-react";
import { StillImage } from "../../../components/ui/still-image";
import { DebugTrigger } from "../../debug/debug-trigger";
import { useServerUpdates } from "../../updates/use-server-updates";
import { ContextMenu } from "../../../components/ui/context-menu";
import { MenuItem } from "../../../components/ui/menu";
import { WorkspaceActions } from "./workspace-menu";
import type { OpenManagement, Workspace } from "../types";

interface WorkspaceRailProps {
  workspaces: Workspace[];
  selectedId?: string;
  pendingId?: string;
  onSelect: (workspace: Workspace) => void;
  onCreate: () => void;
  onManage: OpenManagement;
  onSettings: () => void;
  settingsActive?: boolean;
}

export function WorkspaceRail({
  workspaces,
  selectedId,
  pendingId,
  onSelect,
  onCreate,
  onManage,
  onSettings,
  settingsActive,
}: WorkspaceRailProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const updates = useServerUpdates();
  return (
    <nav className="workspace-rail" aria-label="Workspaces">
      <ComicHalftone />
      <DebugTrigger />
      <span className="rail-divider" />

      <ContextMenu
        label="Project rail actions"
        menu={<MenuItem onSelect={onCreate}>Create project</MenuItem>}
      >
        <div className="workspace-buttons">
          {workspaces.map((workspace) => (
            <ContextMenu
              key={workspace.id}
              label={`Actions for project ${workspace.name}`}
              menu={
                <>
                  <MenuItem onSelect={() => onSelect(workspace)}>
                    Open project
                  </MenuItem>
                  <WorkspaceActions workspace={workspace} onManage={onManage} />
                </>
              }
            >
              <button
                title={workspace.name}
                aria-label={`Open workspace ${workspace.name}`}
                aria-current={
                  !settingsActive && workspace.id === selectedId
                    ? "page"
                    : undefined
                }
                aria-busy={workspace.id === pendingId || undefined}
                className={`workspace-button ${!settingsActive && workspace.id === selectedId ? "workspace-selected" : ""}`}
                onClick={() => onSelect(workspace)}
                onPointerEnter={(event) => {
                  if (event.pointerType === "mouse") setHovered(workspace.id);
                }}
                onPointerLeave={() => setHovered(null)}
              >
                <span className="workspace-icon" aria-hidden="true">
                  {workspace.icon_url ? (
                    <StillImage
                      src={workspace.icon_url}
                      alt=""
                      playing={hovered === workspace.id}
                    />
                  ) : (
                    workspace.icon
                  )}
                </span>
                <span className="workspace-name">{workspace.name}</span>
              </button>
            </ContextMenu>
          ))}
          <button
            className="workspace-add"
            title="Create workspace"
            aria-label="Create workspace"
            onClick={onCreate}
          >
            <span className="workspace-icon" aria-hidden="true">
              <Plus size={18} />
            </span>
            <span className="workspace-name">New</span>
          </button>
        </div>
      </ContextMenu>
      <button
        className="workspace-settings"
        aria-current={settingsActive ? "page" : undefined}
        title="Settings"
        aria-label="Settings"
        onClick={onSettings}
      >
        <span className="workspace-settings-icon">
          <Settings size={20} aria-hidden="true" />
          {updates.data?.available && (
            <span className="update-indicator" aria-label="Update available" />
          )}
        </span>
        <span className="workspace-name">Settings</span>
      </button>
    </nav>
  );
}
