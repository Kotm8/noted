import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { SearchSidebar } from "../search/components/search-sidebar";
import type { SearchResult } from "../search/types";
import { SettingsDialog } from "../settings/components/settings-dialog";
import { NotesTimeline } from "../notes/components/notes-timeline";
import { ChannelHeader } from "./components/channel-header";
import { ChannelSidebar } from "./components/channel-sidebar";
import { ManagementDialog } from "./components/management-dialog";
import { WorkspaceEmpty } from "./components/workspace-empty";
import { WorkspaceRail } from "./components/workspace-rail";
import { useWorkspaceNavigation } from "./hooks/use-workspace-navigation";
import type { Channel, ManagementAction, Workspace } from "./types";
import { NotificationPrompt } from "../notifications/notification-prompt";
import { useNotifications } from "../notifications/use-notifications";

export function WorkspacePage() {
  useNotifications();
  const navigate = useNavigate();
  const navigation = useWorkspaceNavigation();
  const [management, setManagement] = useState<ManagementAction | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [targetNote, setTargetNote] = useState<{
    channelId: string;
    id: string;
  } | null>(() => {
    const id = new URLSearchParams(window.location.search).get("note");
    return id
      ? { channelId: window.location.pathname.split("/").at(-1) ?? "", id }
      : null;
  });
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      const isChannelShortcut =
        (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k";
      if (isChannelShortcut) {
        event.preventDefault();
        setSearchOpen(true);
        searchInputRef.current?.focus();
      }
      if (event.key === "Escape") {
        setMobileNavigationOpen(false);
        setSearchOpen(false);
      }
    }

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  function selectWorkspace(workspace: Workspace) {
    navigate(`/w/${workspace.id}`);
    setMobileNavigationOpen(false);
  }

  function selectChannel(channel: Channel) {
    navigate(`/w/${channel.workspace_id}/c/${channel.id}`);
    setMobileNavigationOpen(false);
    setTargetNote(null);
  }

  function selectResult(result: SearchResult) {
    navigate(`/w/${result.workspace_id}/c/${result.channel_id}`);
    setTargetNote({ channelId: result.channel_id, id: result.id });
    if (window.matchMedia("(max-width: 760px)").matches) setSearchOpen(false);
  }

  return (
    <div
      className={`app-shell ${mobileNavigationOpen ? "mobile-nav-open" : ""} ${searchOpen ? "search-open" : ""}`}
    >
      {mobileNavigationOpen && (
        <button
          className="mobile-scrim"
          aria-label="Close navigation"
          onClick={() => setMobileNavigationOpen(false)}
        />
      )}

      <WorkspaceRail
        workspaces={navigation.workspaces}
        selectedId={navigation.workspace?.id}
        onSelect={selectWorkspace}
        onCreate={() => setManagement({ kind: "workspace" })}
      />
      <ChannelSidebar
        workspace={navigation.workspace}
        categories={navigation.categories}
        channels={navigation.channels}
        selectedChannelId={navigation.channel?.id}
        isLoading={navigation.isCategoriesLoading}
        error={navigation.error}
        onRetry={navigation.retry}
        onSelect={selectChannel}
        onManage={setManagement}
        onOpenSettings={() => {
          setSettingsOpen(true);
          setMobileNavigationOpen(false);
        }}
      />

      <main className="main-panel">
        <NotificationPrompt />
        <ChannelHeader
          workspace={navigation.workspace}
          channel={navigation.channel}
          onOpenNavigation={() => setMobileNavigationOpen(true)}
          onManage={setManagement}
          searchOpen={searchOpen}
          onOpenSearch={() => {
            setSearchOpen(true);
            searchInputRef.current?.focus();
          }}
        />
        {navigation.channel ? (
          <NotesTimeline
            key={`${navigation.channel.id}-${targetNote?.id ?? "latest"}`}
            channel={navigation.channel}
            targetId={
              targetNote?.channelId === navigation.channel.id
                ? targetNote.id
                : undefined
            }
            onReturnToLatest={() => {
              setTargetNote(null);
              navigate(window.location.pathname, { replace: true });
            }}
          />
        ) : (
          <WorkspaceEmpty
            workspace={navigation.workspace}
            isLoading={navigation.isLoading}
            onManage={setManagement}
          />
        )}
      </main>

      {management && (
        <ManagementDialog
          key={`${management.kind}-${management.item?.id ?? "new"}-${management.deleting}`}
          action={management}
          categories={navigation.categories}
          onClose={() => setManagement(null)}
        />
      )}
      {searchOpen && (
        <SearchSidebar
          inputRef={searchInputRef}
          query={searchQuery}
          workspaces={navigation.workspaces}
          onQueryChange={setSearchQuery}
          onClose={() => setSearchOpen(false)}
          onSelect={selectResult}
        />
      )}
      {settingsOpen && (
        <SettingsDialog onClose={() => setSettingsOpen(false)} />
      )}
    </div>
  );
}
