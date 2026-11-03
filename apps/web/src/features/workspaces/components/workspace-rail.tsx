import { useState } from "react";
import { Plus } from "lucide-react";
import { StillImage } from "../../../components/ui/still-image";
import { DebugTrigger } from "../../debug/debug-trigger";
import type { Workspace } from "../types";

interface WorkspaceRailProps {
  workspaces: Workspace[];
  selectedId?: string;
  pendingId?: string;
  onSelect: (workspace: Workspace) => void;
  onCreate: () => void;
}

export function WorkspaceRail({
  workspaces,
  selectedId,
  pendingId,
  onSelect,
  onCreate,
}: WorkspaceRailProps) {
  const [hovered, setHovered] = useState<string | null>(null);
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
            aria-busy={workspace.id === pendingId || undefined}
            className={`workspace-button ${workspace.id === selectedId ? "workspace-selected" : ""}`}
            onClick={() => onSelect(workspace)}
            onPointerEnter={(event) => {
              if (event.pointerType === "mouse") setHovered(workspace.id);
            }}
            onPointerLeave={() => setHovered(null)}
          >
            {workspace.icon_url ? (
              <StillImage
                src={workspace.icon_url}
                alt=""
                playing={hovered === workspace.id}
              />
            ) : (
              workspace.icon
            )}
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
