import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
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
import { ThreadSidebar } from "../threads/thread-sidebar";
import { JournalList } from "../journals/journal-list";
import { JournalSidebar } from "../journals/journal-sidebar";
import { DocumentPage } from "../notes/documents/document-page";
import { ScheduleBoard } from "../schedule/schedule-board";
import type { TrackingTab } from "../time-tracking/components/tracking-settings";
import { HomePage } from "../home/home-page";
import type { HomeActivity } from "../home/types";
import { isAndroidApp } from "../notifications/android";
import { ChannelSchedulingDialog } from "../publishing/channel-scheduling-dialog";
import { WritingPromptBanner } from "../publishing/writing-prompt-banner";
import {
  syncAndroidRoute,
  useAndroidBackLayer,
} from "../../lib/android-navigation";

export function WorkspacePage() {
  useNotifications();
  const navigate = useNavigate();
  const location = useLocation();
  const navigation = useWorkspaceNavigation();
  const [management, setManagement] = useState<ManagementAction | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [trackingTab, setTrackingTab] = useState<TrackingTab | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [channelScheduling, setChannelScheduling] = useState<{
    channel: Channel;
    tab: "messages" | "writing";
  } | null>(null);
  const [writing, setWriting] = useState<{
    kind: "thread" | "journal";
    id: string;
    channelId: string;
    editing?: boolean;
    targetId?: string;
  } | null>(null);
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
  const [trackerRequest, setTrackerRequest] = useState(0);
  useAndroidBackLayer(mobileNavigationOpen, () =>
    setMobileNavigationOpen(false),
  );
  useAndroidBackLayer(searchOpen, () => setSearchOpen(false));
  useAndroidBackLayer(Boolean(writing), () => setWriting(null));
  useEffect(() => syncAndroidRoute(location.pathname), [location.pathname]);

  function openPage(path: string) {
    navigate(path, { replace: isAndroidApp() && !navigation.isHome });
    setMobileNavigationOpen(false);
    setSearchOpen(false);
    setWriting(null);
  }

  function openHomeActivity(item: HomeActivity) {
    if (item.kind === "plan") {
      setTrackerRequest((value) => value + 1);
      openPage(`/?prompt=${item.id}`);
      if (window.matchMedia("(max-width: 760px)").matches)
        setMobileNavigationOpen(true);
    } else {
      if (item.kind === "writing") {
        openPage(`/w/${item.workspace_id}/c/${item.channel_id}`);
        setTargetNote(null);
        return;
      }
      openPage(`/w/${item.workspace_id}/c/${item.channel_id}?note=${item.id}`);
      setTargetNote({ channelId: item.channel_id!, id: item.id });
    }
  }

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      const isChannelShortcut =
        (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k";
      if (isChannelShortcut) {
        event.preventDefault();
        setSearchOpen(true);
        setWriting(null);
        searchInputRef.current?.focus();
      }
      if (
        event.key === "Escape" &&
        !event.defaultPrevented &&
        !event.isComposing
      ) {
        setMobileNavigationOpen(false);
        setSearchOpen(false);
        setWriting(null);
      }
    }

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  function selectWorkspace(workspace: Workspace) {
    openPage(`/w/${workspace.id}`);
    setTargetNote(null);
  }

  function selectChannel(channel: Channel) {
    openPage(`/w/${channel.workspace_id}/c/${channel.id}`);
    setTargetNote(null);
    setWriting(null);
  }

  function selectResult(result: SearchResult) {
    navigate(`/w/${result.workspace_id}/c/${result.channel_id}`);
    if (result.kind === "journal") {
      setWriting({
        kind: "journal",
        id: result.id,
        channelId: result.channel_id,
      });
      setTargetNote(null);
      setSearchOpen(false);
    } else if (result.kind === "document") {
      setWriting(null);
      setTargetNote(null);
      setSearchOpen(false);
    } else {
      setTargetNote({
        channelId: result.channel_id,
        id: result.thread_root_id ?? result.id,
      });
      if (result.thread_root_id) {
        setWriting({
          kind: "thread",
          id: result.thread_root_id,
          targetId: result.id,
          channelId: result.channel_id,
        });
        setSearchOpen(false);
      } else setWriting(null);
    }
    if (window.matchMedia("(max-width: 760px)").matches) setSearchOpen(false);
  }

  const activeWriting =
    writing?.channelId === navigation.channel?.id ? writing : null;

  function openTracking(tab: TrackingTab) {
    setTrackingTab(tab);
    setSettingsOpen(true);
    setMobileNavigationOpen(false);
  }

  return (
    <div
      className={`app-shell ${mobileNavigationOpen ? "mobile-nav-open" : ""} ${searchOpen ? "search-open" : ""} ${activeWriting ? "writing-open" : ""}`}
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
        onHome={() => openPage("/")}
        homeActive={navigation.isHome}
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
          setTrackingTab(null);
          setSettingsOpen(true);
          setMobileNavigationOpen(false);
        }}
        scheduleActive={navigation.isSchedule}
        homeActive={navigation.isHome}
        onHome={() => openPage("/")}
        workspaces={navigation.workspaces}
        onWorkspace={selectWorkspace}
        onMissed={() => openPage("/#missed")}
        onSchedule={() => {
          openPage("/schedule");
        }}
        onTrackingSettings={() => openTracking("activities")}
        trackerRequest={trackerRequest}
      />

      <main className="main-panel">
        <NotificationPrompt />
        {navigation.isHome ? (
          <HomePage
            onNavigation={() => setMobileNavigationOpen(true)}
            onCalendar={() => openPage("/schedule")}
            onSearch={() => {
              setSearchOpen(true);
              setWriting(null);
            }}
            onActivity={() => {
              window.dispatchEvent(new Event("noted:choose-activity"));
              if (window.matchMedia("(max-width: 760px)").matches)
                setMobileNavigationOpen(true);
            }}
            onOpen={openHomeActivity}
          />
        ) : navigation.isSchedule ? (
          <ScheduleBoard
            onNavigation={() => setMobileNavigationOpen(true)}
            onSettings={() => openTracking("schedule")}
            onReminder={(flag) => {
              openPage(
                `/w/${flag.workspace_id}/c/${flag.channel_id}?note=${flag.message_id}`,
              );
              setTargetNote({
                channelId: flag.channel_id,
                id: flag.message_id,
              });
            }}
          />
        ) : (
          <>
            <ChannelHeader
              workspace={navigation.workspace}
              channel={navigation.channel}
              onOpenNavigation={() => setMobileNavigationOpen(true)}
              onManage={setManagement}
              onScheduling={(tab) => {
                if (navigation.channel)
                  setChannelScheduling({ channel: navigation.channel, tab });
              }}
              searchOpen={searchOpen}
              onOpenSearch={() => {
                setSearchOpen(true);
                setWriting(null);
                searchInputRef.current?.focus();
              }}
            />
            {navigation.channel && (
              <WritingPromptBanner channelId={navigation.channel.id} />
            )}
            {navigation.channel?.kind === "document" ? (
              <DocumentPage
                key={navigation.channel.id}
                channel={navigation.channel}
              />
            ) : navigation.channel?.kind === "journal" ? (
              <JournalList
                key={navigation.channel.id}
                channel={navigation.channel}
                selectedId={
                  activeWriting?.kind === "journal"
                    ? activeWriting.id
                    : undefined
                }
                onSelect={(id, editing = false) => {
                  setSearchOpen(false);
                  setWriting({
                    kind: "journal",
                    id,
                    channelId: navigation.channel!.id,
                    editing,
                  });
                }}
              />
            ) : navigation.channel ? (
              <NotesTimeline
                key={`${navigation.channel.id}-${targetNote?.id ?? "latest"}`}
                channel={navigation.channel}
                onOpenThread={(id) => {
                  setSearchOpen(false);
                  setWriting({
                    kind: "thread",
                    id,
                    channelId: navigation.channel!.id,
                  });
                }}
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
          </>
        )}
      </main>

      {activeWriting &&
        navigation.channel &&
        (activeWriting.kind === "thread" ? (
          <ThreadSidebar
            key={`${activeWriting.id}-${activeWriting.targetId ?? "latest"}`}
            rootId={activeWriting.id}
            targetId={activeWriting.targetId}
            onReturnToLatest={() =>
              setWriting((current) =>
                current ? { ...current, targetId: undefined } : null,
              )
            }
            channel={navigation.channel}
            onClose={() => setWriting(null)}
          />
        ) : (
          <JournalSidebar
            key={activeWriting.id}
            entryId={activeWriting.id}
            editing={activeWriting.editing ?? false}
            onClose={() => setWriting(null)}
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
      {channelScheduling && (
        <ChannelSchedulingDialog
          channel={channelScheduling.channel}
          initialTab={channelScheduling.tab}
          onClose={() => setChannelScheduling(null)}
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
        <SettingsDialog
          initialTab={trackingTab ? "tracking" : "appearance"}
          trackingTab={trackingTab ?? undefined}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}
