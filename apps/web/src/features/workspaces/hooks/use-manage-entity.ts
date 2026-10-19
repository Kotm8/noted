import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { categoryApi, channelApi, workspaceApi } from "../api";
import type { Category, Channel, ManagementAction, Workspace } from "../types";

export interface ManagementFormValues {
  name: string;
  icon: string;
  categoryId: string;
  image?: File | null;
  kind?: "note" | "reminder" | "journal" | "document";
}

async function saveEntity(
  action: ManagementAction,
  values: ManagementFormValues,
  createdWorkspace: { current: Workspace | null },
  createdChannel: { current: Channel | null },
) {
  const position = action.item?.position ?? 0;

  switch (action.kind) {
    case "workspace": {
      const data = { name: values.name, icon: values.icon, position };
      const existing = action.item ?? createdWorkspace.current;
      const workspace = existing
        ? await workspaceApi.update(existing.id, data)
        : await workspaceApi.create(data);
      if (!action.item) createdWorkspace.current = workspace;
      if (values.image)
        return workspaceApi.setImage(workspace.id, values.image);
      if (values.image === null && workspace.icon_url)
        return workspaceApi.removeImage(workspace.id);
      return workspace;
    }
    case "category": {
      const data = { name: values.name, position };
      return action.item
        ? categoryApi.update(action.item.id, data)
        : categoryApi.create(action.workspaceId, data);
    }
    case "channel": {
      const data = {
        name: values.name,
        category_id: values.categoryId || null,
        position,
        kind: values.kind ?? "note",
      };
      const existing = action.item ?? createdChannel.current;
      const channel = existing
        ? await channelApi.update(existing.id, data)
        : await channelApi.create(action.workspaceId, data);
      if (!action.item) createdChannel.current = channel;
      if (values.image) return channelApi.setBanner(channel.id, values.image);
      if (values.image === null && channel.banner_url)
        return channelApi.removeBanner(channel.id);
      return channel;
    }
  }
}

async function deleteEntity(action: ManagementAction): Promise<void> {
  if (!action.item) throw new Error("Select an item to delete.");

  switch (action.kind) {
    case "workspace":
      return workspaceApi.remove(action.item.id);
    case "category":
      return categoryApi.remove(action.item.id);
    case "channel":
      return channelApi.remove(action.item.id);
  }
}

export function useManageEntity(
  action: ManagementAction,
  onComplete: () => void,
) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const createdWorkspace = useRef<Workspace | null>(null);
  const createdChannel = useRef<Channel | null>(null);

  return useMutation<
    Workspace | Category | Channel | void,
    Error,
    ManagementFormValues
  >({
    mutationFn: (values) =>
      action.deleting
        ? deleteEntity(action)
        : saveEntity(action, values, createdWorkspace, createdChannel),
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      void queryClient.invalidateQueries({ queryKey: ["channels"] });
    },
    onSuccess: async (item) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["workspaces"] }),
        queryClient.invalidateQueries({ queryKey: ["categories"] }),
        queryClient.invalidateQueries({ queryKey: ["channels"] }),
        queryClient.invalidateQueries({ queryKey: ["search"] }),
      ]);

      if (item && !action.item) {
        if (action.kind === "workspace") navigate(`/w/${item.id}`);
        if (action.kind === "channel")
          navigate(`/w/${action.workspaceId}/c/${item.id}`);
      }

      const name = action.kind[0].toUpperCase() + action.kind.slice(1);
      const result = action.deleting
        ? "deleted"
        : action.item
          ? "updated"
          : "created";
      toast.success(`${name} ${result}`);
      onComplete();
    },
  });
}
