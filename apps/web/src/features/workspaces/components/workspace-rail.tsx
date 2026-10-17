import { Plus } from "lucide-react";
import { DebugTrigger } from "../../debug/debug-trigger";
import type { Workspace } from "../types";

interface WorkspaceRailProps {
  workspaces: Workspace[];
  selectedId?: string;
  onSelect: (workspace: Workspace) => void;
  onCreate: () => void;
}

export function WorkspaceRail({ workspaces, selectedId, onSelect, onCreate }: WorkspaceRailProps) {
  return (
    <nav className="workspace-rail" aria-label="Workspaces">
      <DebugTrigger />
      <span className="rail-divider" />

      <div className="workspace-buttons">
        {workspaces.map((workspace) => (
          <button
            key={workspace.id}
            title={workspace.name}
            aria-label={`Open workspace ${workspace.name}`}
            aria-current={workspace.id === selectedId ? "page" : undefined}
            className={`workspace-button ${workspace.id === selectedId ? "workspace-selected" : ""}`}
            onClick={() => onSelect(workspace)}
          >
            {workspace.icon_url ? <img src={workspace.icon_url} alt="" /> : workspace.icon}
          </button>
        ))}
        <button
          className="workspace-add"
          title="Create workspace"
          aria-label="Create workspace"
          onClick={onCreate}
        >
          <Plus size={21} />
        </button>
      </div>
    </nav>
  );
}
