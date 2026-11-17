import { useNavigate, useSearchParams } from "react-router-dom";
import { ChannelLibrary } from "../../notes/library/channel-library";
import { JournalList } from "../../journals/journal-list";
import { NotesTimeline } from "../../notes/components/notes-timeline";
import { DocumentPage } from "../../notes/documents/document-page";
import { WritingPromptBanner } from "../../publishing/writing-prompt-banner";
import { NudgeBanner } from "../../writing-nudges/nudge-banner";
import { ChannelHeader } from "../components/channel-header";
import { WorkspaceEmpty } from "../components/workspace-empty";
import { useWorkspaceShell } from "../shell-context";
import type { Channel } from "../types";

export function ChannelRoute() {
  const [params, setParams] = useSearchParams();
  const shell = useWorkspaceShell();
  const { workspace, channel, isLoading } = shell.navigation;
  const files = params.get("view") === "files";
  function setFiles(open: boolean) {
    setParams(
      (current) => {
        if (open) current.set("view", "files");
        else current.delete("view");
        return current;
      },
      { replace: true },
    );
  }
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
      {channel && !["document", "journal"].includes(channel.kind ?? "note") && (
        <div className="channel-views" role="tablist" aria-label="Channel view">
          <button
            role="tab"
            aria-selected={!files}
            onClick={() => setFiles(false)}
          >
            {channel.kind === "document"
              ? "Notes"
              : channel.kind === "journal"
                ? "Journal"
                : "Messages"}
          </button>
          <button
            role="tab"
            aria-selected={files}
            onClick={() => setFiles(true)}
          >
            Files &amp; links
          </button>
        </div>
      )}
      {channel && !files && <WritingPromptBanner channelId={channel.id} />}
      {channel && <NudgeBanner channelId={channel.id} />}
      {channel ? (
        files ? (
          <ChannelLibrary
            channelId={channel.id}
            onOpen={(id, root) => {
              shell.openNote({
                workspaceId: channel.workspace_id,
                channelId: channel.id,
                noteId: root ?? id,
                threadId: root ?? undefined,
                replyId: root ? id : undefined,
              });
            }}
          />
        ) : (
          <ChannelContent channel={channel} />
        )
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
