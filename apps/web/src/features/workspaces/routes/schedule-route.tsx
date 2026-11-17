import { ScheduleBoard } from "../../schedule/schedule-board";
import { useWorkspaceShell } from "../shell-context";
import { useSearchParams } from "react-router-dom";

export function ScheduleRoute() {
  const shell = useWorkspaceShell();
  const [params] = useSearchParams();
  const candidate = params.get("date") ?? "";
  const parsed = new Date(`${candidate}T12:00:00Z`);
  const date =
    /^\d{4}-\d{2}-\d{2}$/.test(candidate) &&
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === candidate
      ? candidate
      : undefined;
  return (
    <ScheduleBoard
      key={date ?? "today"}
      initialDate={date}
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
