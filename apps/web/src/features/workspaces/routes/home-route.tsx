import { HomePage } from "../../home/home-page";
import type { HomeActivity } from "../../home/types";
import { isMobileLayout } from "../../../lib/layout";
import { useWorkspaceShell } from "../shell-context";

export function HomeRoute() {
  const shell = useWorkspaceShell();

  function openActivity(item: HomeActivity) {
    if (item.kind === "plan") {
      shell.openPage(`/?prompt=${item.id}`);
    } else if (item.kind === "writing") {
      shell.openChannel(item.workspace_id!, item.channel_id!);
    } else {
      shell.openNote({
        workspaceId: item.workspace_id!,
        channelId: item.channel_id!,
        noteId: item.id,
      });
    }
  }

  return (
    <HomePage
      onNavigation={shell.openNavigation}
      onCalendar={() => shell.openPage("/schedule")}
      onSearch={shell.openSearch}
      onActivity={() => {
        window.dispatchEvent(new Event("noted:choose-activity"));
        if (isMobileLayout()) shell.openNavigation();
      }}
      onOpen={openActivity}
      onChannel={(channel) =>
        shell.openChannel(channel.workspace_id, channel.id)
      }
    />
  );
}
