import { useOutletContext } from "react-router-dom";
import type { TrackingSection } from "../time-tracking/components/tracking-settings";
import type { useChannelNavigation } from "./hooks/use-channel-navigation";
import type { useWorkspaceNavigation } from "./hooks/use-workspace-navigation";
import type { Channel, ManagementAction } from "./types";

export interface WritingPanel {
  kind: "thread" | "journal";
  id: string;
  channelId: string;
  editing?: boolean;
  targetId?: string;
}

export interface NoteTarget {
  workspaceId: string;
  channelId: string;
  noteId: string;
}

/** What routed pages can ask of the surrounding workspace layout. */
export interface WorkspaceShell {
  navigation: ReturnType<typeof useWorkspaceNavigation>;
  channelNavigation: ReturnType<typeof useChannelNavigation>;
  writing: WritingPanel | null;
  setWriting: (panel: WritingPanel | null) => void;
  targetNote: { channelId: string; id: string } | null;
  clearTargetNote: () => void;
  searchOpen: boolean;
  openPage: (path: string) => void;
  openChannel: (workspaceId: string, channelId: string) => void;
  openNote: (target: NoteTarget) => void;
  openNavigation: () => void;
  openSearch: () => void;
  openTracking: (tab: TrackingSection) => void;
  manage: (action: ManagementAction) => void;
  scheduleChannel: (channel: Channel, tab: "messages" | "writing") => void;
}

export function useWorkspaceShell() {
  return useOutletContext<WorkspaceShell>();
}
