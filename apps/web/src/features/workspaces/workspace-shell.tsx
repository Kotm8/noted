import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { isMobileLayout } from "../../lib/layout";
import {
  syncAndroidRoute,
  useAndroidBackLayer,
} from "../../lib/android-navigation";
import { finishStartup } from "../../lib/startup";
import { JournalSidebar } from "../journals/journal-sidebar";
import { isAndroidApp } from "../notifications/android";
import { NotificationPrompt } from "../notifications/notification-prompt";
import { useNotifications } from "../notifications/use-notifications";
import { SearchSidebar } from "../search/components/search-sidebar";
import type { SearchResult } from "../search/types";
import { ThreadSidebar } from "../threads/thread-sidebar";
import type { TrackingSection } from "../time-tracking/components/tracking-settings";
import { StartupPrompt } from "../desktop/startup/startup-prompt";
import { ChannelSidebar } from "./components/channel-sidebar";
import { ManagementDialog } from "./components/management-dialog";
import { WorkspaceRail } from "./components/workspace-rail";
import { MentionContext } from "../notes/mention-context";
import { useAllChannels } from "./hooks/use-all-channels";
import { useChannelNavigation } from "./hooks/use-channel-navigation";
import { useSidebarSwipe } from "./hooks/use-sidebar-swipe";
import { useWorkspaceNavigation } from "./hooks/use-workspace-navigation";
import type {
  NoteTarget,
  WorkspaceShell as ShellContext,
  WritingPanel,
} from "./shell-context";
import type { Channel, ManagementAction, Workspace } from "./types";

const SettingsDialog = lazy(() =>
  import("../settings/components/settings-dialog").then((module) => ({
    default: module.SettingsDialog,
  })),
);
const ChannelSchedulingDialog = lazy(() =>
  import("../publishing/channel-scheduling-dialog").then((module) => ({
    default: module.ChannelSchedulingDialog,
  })),
);

function initialTargetNote() {
  const id = new URLSearchParams(window.location.search).get("note");
  return id
    ? { channelId: window.location.pathname.split("/").at(-1) ?? "", id }
    : null;
}

/** Layout around every signed-in page: navigation, search, panels and dialogs. */
export function WorkspaceShell() {
  useNotifications();
  const navigate = useNavigate();
  const location = useLocation();
  const navigation = useWorkspaceNavigation();
  const allChannels = useAllChannels();
  const channelNavigation = useChannelNavigation();
  const cancelChannelNavigation = channelNavigation.cancel;
  const initialPageReady =
    !navigation.isLoading &&
    (navigation.isHome ||
      navigation.isSchedule ||
      Boolean(navigation.channel) ||
      !navigation.workspaces.length ||
      Boolean(navigation.workspace && !navigation.channels.length));
  useEffect(() => {
    if (initialPageReady || navigation.error) finishStartup();
  }, [initialPageReady, navigation.error]);

  const [management, setManagement] = useState<ManagementAction | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [trackingSection, setTrackingSection] =
    useState<TrackingSection | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [channelScheduling, setChannelScheduling] = useState<{
    channel: Channel;
    tab: "messages" | "writing";
  } | null>(null);
  const [writing, setWritingPanel] = useState<WritingPanel | null>(null);
  const [targetNote, setTargetNote] = useState(initialTargetNote);
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [trackerRequest, setTrackerRequest] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const sidebarSwipeRef = useSidebarSwipe(
    mobileNavigationOpen,
    settingsOpen ||
      Boolean(management) ||
      Boolean(channelScheduling) ||
      searchOpen ||
      Boolean(writing),
    (open) => {
      if (!open) cancelChannelNavigation();
      setMobileNavigationOpen(open);
    },
  );
  useAndroidBackLayer(mobileNavigationOpen, () => closeNavigation());
  useAndroidBackLayer(searchOpen, () => closeSearch());
  useAndroidBackLayer(Boolean(writing), () => setWritingPanel(null));
  useEffect(() => syncAndroidRoute(location.pathname), [location.pathname]);
  useEffect(() => {
    if (!new URLSearchParams(location.search).get("prompt")) return;
    setTrackerRequest((value) => value + 1);
    setSettingsOpen(false);
    setSearchOpen(false);
    setWritingPanel(null);
    if (isMobileLayout()) setMobileNavigationOpen(true);
  }, [location.key, location.search]);

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openSearch();
      }
      if (
        event.key === "Escape" &&
        !event.defaultPrevented &&
        !event.isComposing
      ) {
        cancelChannelNavigation();
        setMobileNavigationOpen(false);
        setSearchOpen(false);
        setWritingPanel(null);
      }
    }
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [cancelChannelNavigation]);

  function setWriting(panel: WritingPanel | null) {
    if (panel) setSearchOpen(false);
    setWritingPanel(panel);
  }

  function openSearch() {
    setSearchOpen(true);
    setWritingPanel(null);
    searchInputRef.current?.focus();
  }

  function closeSearch() {
    cancelChannelNavigation();
    setSearchOpen(false);
  }

  function closeNavigation() {
    cancelChannelNavigation();
    setMobileNavigationOpen(false);
  }

  function openPage(path: string) {
    cancelChannelNavigation();
    navigate(path, { replace: isAndroidApp() && !navigation.isHome });
    setMobileNavigationOpen(false);
    setSearchOpen(false);
    setWritingPanel(null);
  }

  function openChannel(workspaceId: string, channelId: string) {
    void channelNavigation.open({ workspaceId, channelId }, () => {
      openPage(`/w/${workspaceId}/c/${channelId}`);
      setTargetNote(null);
    });
  }

  function openNote({ workspaceId, channelId, noteId }: NoteTarget) {
    void channelNavigation.open({ workspaceId, channelId, noteId }, () => {
      openPage(`/w/${workspaceId}/c/${channelId}?note=${noteId}`);
      setTargetNote({ channelId, id: noteId });
    });
  }

  function openTracking(tab: TrackingSection | null) {
    cancelChannelNavigation();
    setTrackingSection(tab);
    setSettingsOpen(true);
    setMobileNavigationOpen(false);
  }

  function selectWorkspace(workspace: Workspace) {
    void channelNavigation.open({ workspaceId: workspace.id }, (channel) => {
      openPage(
        channel ? `/w/${workspace.id}/c/${channel.id}` : `/w/${workspace.id}`,
      );
      setTargetNote(null);
    });
  }

  function selectResult(result: SearchResult) {
    const journal = result.kind === "journal";
    const note = !journal && result.kind !== "document";
    void channelNavigation.open(
      {
        workspaceId: result.workspace_id,
        channelId: result.channel_id,
        noteId: note ? (result.thread_root_id ?? result.id) : undefined,
        journalEntryId: journal ? result.id : undefined,
        threadId: result.thread_root_id ?? undefined,
        replyId: result.thread_root_id ? result.id : undefined,
      },
      () => showResult(result),
    );
  }

  function showResult(result: SearchResult) {
    cancelChannelNavigation();
    navigate(`/w/${result.workspace_id}/c/${result.channel_id}`);
    const channelId = result.channel_id;
    if (result.kind === "journal") {
      setWriting({ kind: "journal", id: result.id, channelId });
      setTargetNote(null);
    } else if (result.kind === "document") {
      setWriting(null);
      setTargetNote(null);
      setSearchOpen(false);
    } else {
      const root = result.thread_root_id;
      setTargetNote({ channelId, id: root ?? result.id });
      setWriting(
        root
          ? { kind: "thread", id: root, targetId: result.id, channelId }
          : null,
      );
    }
    if (isMobileLayout()) setSearchOpen(false);
  }

  const activeWriting =
    writing?.channelId === navigation.channel?.id ? writing : null;

  const shell: ShellContext = {
    navigation,
    channelNavigation,
    writing,
    setWriting,
    targetNote,
    clearTargetNote: () => setTargetNote(null),
    searchOpen,
    openPage,
    openChannel,
    openNote,
    openNavigation: () => setMobileNavigationOpen(true),
    openSearch,
    openTracking,
    manage: setManagement,
    scheduleChannel: (channel, tab) => setChannelScheduling({ channel, tab }),
  };
  const mentions = {
    channels: allChannels ?? [],
    workspaces: navigation.workspaces,
    open: (channel: Channel) => openChannel(channel.workspace_id, channel.id),
  };

  return (
    <MentionContext.Provider value={mentions}>
      <div
        ref={sidebarSwipeRef}
        className={`app-shell ${mobileNavigationOpen ? "mobile-nav-open" : ""} ${searchOpen ? "search-open" : ""} ${activeWriting ? "writing-open" : ""}`}
      >
        {mobileNavigationOpen && (
          <button
            className="mobile-scrim"
            aria-label="Close navigation"
            onClick={closeNavigation}
          />
        )}

        <WorkspaceRail
          workspaces={navigation.workspaces}
          selectedId={navigation.workspace?.id}
          pendingId={channelNavigation.pending?.workspaceId}
          onSelect={selectWorkspace}
          onCreate={() => setManagement({ kind: "workspace" })}
          onHome={() => openPage("/")}
          homeActive={navigation.isHome}
          onCalendar={() => openPage("/schedule")}
          calendarActive={navigation.isSchedule}
        />
        <ChannelSidebar
          workspace={navigation.workspace}
          categories={navigation.categories}
          channels={navigation.channels}
          selectedChannelId={navigation.channel?.id}
          pendingChannelId={channelNavigation.pending?.channelId}
          isLoading={navigation.isCategoriesLoading}
          error={navigation.error}
          onRetry={navigation.retry}
          onSelect={(channel) => openChannel(channel.workspace_id, channel.id)}
          onManage={setManagement}
          onOpenSettings={() => openTracking(null)}
          scheduleActive={navigation.isSchedule}
          homeActive={navigation.isHome}
          onHome={() => openPage("/")}
          workspaces={navigation.workspaces}
          onWorkspace={selectWorkspace}
          onMissed={() => openPage("/#missed")}
          onSchedule={() => openPage("/schedule")}
          onTrackingSettings={() => openTracking("activities")}
          trackerRequest={trackerRequest}
        />

        <main className="main-panel">
          <NotificationPrompt />
          <Suspense fallback={null}>
            <Outlet context={shell} />
          </Suspense>
        </main>

        {activeWriting &&
          navigation.channel &&
          (activeWriting.kind === "thread" ? (
            <ThreadSidebar
              key={`${activeWriting.id}-${activeWriting.targetId ?? "latest"}`}
              rootId={activeWriting.id}
              targetId={activeWriting.targetId}
              onReturnToLatest={() =>
                setWritingPanel({ ...activeWriting, targetId: undefined })
              }
              channel={navigation.channel}
              onClose={() => setWritingPanel(null)}
            />
          ) : (
            <JournalSidebar
              key={activeWriting.id}
              entryId={activeWriting.id}
              editing={activeWriting.editing ?? false}
              onClose={() => setWritingPanel(null)}
            />
          ))}

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
            onClose={closeSearch}
            onSelect={selectResult}
          />
        )}
        <StartupPrompt />
        <Suspense fallback={null}>
          {channelScheduling && (
            <ChannelSchedulingDialog
              channel={channelScheduling.channel}
              initialTab={channelScheduling.tab}
              onClose={() => setChannelScheduling(null)}
            />
          )}
          {settingsOpen && (
            <SettingsDialog
              initialTab={trackingSection ? "tracking" : "appearance"}
              trackingSection={trackingSection ?? undefined}
              onClose={() => setSettingsOpen(false)}
            />
          )}
        </Suspense>
      </div>
    </MentionContext.Provider>
  );
}
