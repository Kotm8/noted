import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useMatch, useNavigate } from "react-router-dom";
import { readStoredValue, writeStoredValue } from "../../../lib/storage";
import { categoryApi, channelApi, workspaceApi } from "../api";
import type { Workspace } from "../types";

export function useWorkspaceChannels(workspace?: Workspace) {
  const workspaceId = workspace?.id ?? "";
  const categories = useQuery({
    queryKey: ["categories", workspaceId],
    queryFn: () => categoryApi.list(workspaceId),
    enabled: Boolean(workspace),
  });
  const channels = useQuery({
    queryKey: ["channels", workspaceId],
    queryFn: () => channelApi.list(workspaceId),
    enabled: Boolean(workspace),
  });
  return { categories, channels };
}

export function useWorkspaceNavigation() {
  const navigate = useNavigate();
  const channelRoute = useMatch("/w/:workspaceId/c/:channelId");
  const workspaceRoute = useMatch("/w/:workspaceId");
  const isHabits = useMatch("/habits") !== null;
  const isNutrition = useMatch("/nutrition") !== null;
  const isFinance = useMatch("/finance") !== null;
  const isSchedule = useMatch("/schedule") !== null;
  const homeRoute = useMatch("/home");
  const rootRoute = useMatch("/");
  const isHome = homeRoute !== null || rootRoute !== null;
  const workspaceId =
    channelRoute?.params.workspaceId ?? workspaceRoute?.params.workspaceId;
  const channelId = channelRoute?.params.channelId;

  const workspacesQuery = useQuery({
    queryKey: ["workspaces"],
    queryFn: workspaceApi.list,
  });
  const globalPage =
    isHome || isSchedule || isHabits || isNutrition || isFinance;
  const rememberedWorkspaceId =
    readStoredValue("noted.navigation")?.split("/")[2];
  const workspace = globalPage
    ? (workspacesQuery.data?.find(
        (item) => item.id === rememberedWorkspaceId,
      ) ?? workspacesQuery.data?.[0])
    : workspacesQuery.data?.find((item) => item.id === workspaceId);
  const { categories: categoriesQuery, channels: channelsQuery } =
    useWorkspaceChannels(workspace);
  const channel = channelsQuery.data?.find((item) => item.id === channelId);

  useEffect(() => {
    if (isSchedule || isHome || isHabits || isNutrition || isFinance) return;
    if (!workspacesQuery.data?.length || workspace) {
      return;
    }

    const lastPath = readStoredValue("noted.navigation");
    const hasSavedWorkspace =
      lastPath &&
      workspacesQuery.data.some((item) => lastPath.startsWith(`/w/${item.id}`));
    const destination = hasSavedWorkspace
      ? lastPath
      : `/w/${workspacesQuery.data[0].id}`;
    navigate(destination, { replace: true });
  }, [
    workspacesQuery.data,
    workspace,
    navigate,
    isSchedule,
    isHome,
    isHabits,
    isNutrition,
    isFinance,
  ]);

  useEffect(() => {
    if (isSchedule || isHome || isHabits || isNutrition || isFinance) return;
    if (!workspace || !channelsQuery.data || channel) {
      return;
    }

    if (channelsQuery.data.length === 0) {
      if (channelId) navigate(`/w/${workspace.id}`, { replace: true });
      return;
    }

    const savedChannelId = readStoredValue(`noted.channel.${workspace.id}`);
    const savedChannel = channelsQuery.data.find(
      (item) => item.id === savedChannelId,
    );
    const destination = savedChannel ?? channelsQuery.data[0];
    navigate(`/w/${workspace.id}/c/${destination.id}`, { replace: true });
  }, [
    workspace,
    channelsQuery.data,
    channel,
    channelId,
    navigate,
    isSchedule,
    isHome,
    isHabits,
    isNutrition,
    isFinance,
  ]);

  useEffect(() => {
    if (isFinance) {
      document.title = "Finance · Noted";
      return;
    }
    if (isHabits) {
      document.title = "Habits \u00b7 Noted";
      return;
    }
    if (isNutrition) {
      document.title = "Nutrition · Noted";
      return;
    }
    if (isHome) {
      document.title = "Home · Noted";
      return;
    }
    if (isSchedule) {
      document.title = "Schedule · Noted";
      return;
    }
    if (!workspace) return;

    const channelPath = channel ? `/c/${channel.id}` : "";
    writeStoredValue("noted.navigation", `/w/${workspace.id}${channelPath}`);
    if (channel) writeStoredValue(`noted.channel.${workspace.id}`, channel.id);
    document.title = `${channel ? `#${channel.name}` : workspace.name} · Noted`;
  }, [
    workspace,
    channel,
    isSchedule,
    isHome,
    isHabits,
    isNutrition,
    isFinance,
  ]);

  function retry() {
    void workspacesQuery.refetch();
    if (workspace) {
      void categoriesQuery.refetch();
      void channelsQuery.refetch();
    }
  }

  return {
    isFinance,
    isSchedule,
    isHome,
    isHabits,
    isNutrition,
    workspace,
    channel,
    workspaces: workspacesQuery.data ?? [],
    categories: categoriesQuery.data ?? [],
    channels: channelsQuery.data ?? [],
    isLoading:
      workspacesQuery.isPending ||
      Boolean(workspace && channelsQuery.isPending),
    isCategoriesLoading: Boolean(workspace && categoriesQuery.isPending),
    error:
      workspacesQuery.error ?? categoriesQuery.error ?? channelsQuery.error,
    retry,
  };
}
