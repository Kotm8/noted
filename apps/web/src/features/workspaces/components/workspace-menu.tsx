import { ChevronDown, FolderPlus, Hash, Pencil, Trash2 } from "lucide-react";
import { Menu, MenuItem } from "../../../components/ui/menu";
import type { OpenManagement, Workspace } from "../types";

interface WorkspaceMenuProps {
  workspace?: Workspace;
  onManage: OpenManagement;
}

export function WorkspaceMenu({ workspace, onManage }: WorkspaceMenuProps) {
  const title = (
    <span>
      <strong>{workspace?.name ?? "Workspaces"}</strong>
    </span>
  );

  if (!workspace) return <div className="workspace-title">{title}</div>;

  return (
    <Menu
      trigger={
        <button className="workspace-title" aria-label={`${workspace.name} workspace menu`}>
          {title}
          <ChevronDown size={17} />
        </button>
      }
    >
      <MenuItem onSelect={() => onManage({ kind: "channel", workspaceId: workspace.id })}>
        <Hash size={14} />
        Create channel
      </MenuItem>
      <MenuItem onSelect={() => onManage({ kind: "category", workspaceId: workspace.id })}>
        <FolderPlus size={14} />
        Create category
      </MenuItem>
      <MenuItem onSelect={() => onManage({ kind: "workspace", item: workspace })}>
        <Pencil size={14} />
        Edit workspace
      </MenuItem>
      <MenuItem
        danger
        onSelect={() => onManage({ kind: "workspace", item: workspace, deleting: true })}
      >
        <Trash2 size={14} />
        Delete workspace
      </MenuItem>
    </Menu>
  );
}
