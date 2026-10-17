import { LoaderCircle, Plus } from "lucide-react";
import { Button } from "../../../components/ui/button";
import type { OpenManagement, Workspace } from "../types";

interface WorkspaceEmptyProps {
  workspace?: Workspace;
  isLoading: boolean;
  onManage: OpenManagement;
}

export function WorkspaceEmpty({ workspace, isLoading, onManage }: WorkspaceEmptyProps) {
  if (isLoading) {
    return (
      <div className="empty-main">
        <LoaderCircle className="animate-spin" size={24} aria-label="Loading workspace" />
      </div>
    );
  }

  function handleCreate() {
    if (workspace) onManage({ kind: "channel", workspaceId: workspace.id });
    else onManage({ kind: "workspace" });
  }

  return (
    <div className="empty-main">
      <h2>{workspace ? "No channels yet" : "No workspaces yet"}</h2>
      <p>
        {workspace
          ? "Create a channel to keep related notes together."
          : "Create a workspace for a project, your studies, or personal notes."}
      </p>
      <Button onClick={handleCreate}>
        <Plus size={17} />
        Create {workspace ? "a channel" : "your first workspace"}
      </Button>
    </div>
  );
}
