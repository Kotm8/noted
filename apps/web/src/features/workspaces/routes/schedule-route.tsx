import { ScheduleBoard } from "../../schedule/schedule-board";
import { useWorkspaceShell } from "../shell-context";

export function ScheduleRoute() {
  const shell = useWorkspaceShell();
  return (
    <ScheduleBoard
      onNavigation={shell.openNavigation}
      onSettings={() => shell.openTracking("schedule")}
      onReminder={(flag) =>
        shell.openNote({
          workspaceId: flag.workspace_id,
          channelId: flag.channel_id,
          noteId: flag.message_id,
        })
      }
    />
  );
}
