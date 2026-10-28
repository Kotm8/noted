import { useNavigate } from "react-router-dom";
import { JournalList } from "../../journals/journal-list";
import { NotesTimeline } from "../../notes/components/notes-timeline";
import { DocumentPage } from "../../notes/documents/document-page";
import { WritingPromptBanner } from "../../publishing/writing-prompt-banner";
import { ChannelHeader } from "../components/channel-header";
import { WorkspaceEmpty } from "../components/workspace-empty";
import { useWorkspaceShell } from "../shell-context";
import type { Channel } from "../types";

export function ChannelRoute() {
  const shell = useWorkspaceShell();
  const { workspace, channel, isLoading } = shell.navigation;
  return (
    <>
      <ChannelHeader
        workspace={workspace}
        channel={channel}
        onOpenNavigation={shell.openNavigation}
        onManage={shell.manage}
        onScheduling={(tab) => channel && shell.scheduleChannel(channel, tab)}
        searchOpen={shell.searchOpen}
        onOpenSearch={shell.openSearch}
      />
      {channel && <WritingPromptBanner channelId={channel.id} />}
      {channel ? (
        <ChannelContent channel={channel} />
      ) : (
        <WorkspaceEmpty
          workspace={workspace}
          isLoading={isLoading}
          onManage={shell.manage}
        />
      )}
    </>
  );
}

function ChannelContent({ channel }: { channel: Channel }) {
  const shell = useWorkspaceShell();
  const navigate = useNavigate();
  const writing =
    shell.writing?.channelId === channel.id ? shell.writing : null;

  if (channel.kind === "document")
    return <DocumentPage key={channel.id} channel={channel} />;

  if (channel.kind === "journal")
    return (
      <JournalList
        key={channel.id}
        channel={channel}
        selectedId={writing?.kind === "journal" ? writing.id : undefined}
        onSelect={(id, editing = false) =>
          shell.setWriting({
            kind: "journal",
            id,
            channelId: channel.id,
            editing,
          })
        }
      />
    );

  const targetId =
    shell.targetNote?.channelId === channel.id
      ? shell.targetNote.id
      : undefined;
  return (
    <NotesTimeline
      key={`${channel.id}-${targetId ?? "latest"}`}
      channel={channel}
      onOpenThread={(id) =>
        shell.setWriting({ kind: "thread", id, channelId: channel.id })
      }
      targetId={targetId}
      onReturnToLatest={() => {
        shell.clearTargetNote();
        navigate(window.location.pathname, { replace: true });
      }}
    />
  );
}
