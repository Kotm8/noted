import { createContext, useContext } from "react";
import type { Channel, Workspace } from "../workspaces/types";

interface MentionDirectory {
  channels: Channel[];
  workspaces: Workspace[];
  open: (channel: Channel) => void;
}

/**
 * Provided by the workspace shell so Markdown and text boxes can resolve and
 * open #mentions without depending on the router or data fetching themselves.
 */
export const MentionContext = createContext<MentionDirectory>({
  channels: [],
  workspaces: [],
  open: () => {},
});

export const useMentionDirectory = () => useContext(MentionContext);
