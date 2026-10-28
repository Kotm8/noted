import { fetchAllPages, request } from "../../lib/http";
import type {
  Category,
  CategoryInput,
  Channel,
  ChannelInput,
  Workspace,
  WorkspaceInput,
  SidebarMove,
  SidebarOrder,
} from "./types";

export const workspaceApi = {
  move(workspaceId: string, data: SidebarMove): Promise<SidebarOrder> {
    return request<SidebarOrder>(
      `/workspaces/${workspaceId}/order`,
      "PUT",
      data,
    );
  },
  list(): Promise<Workspace[]> {
    return fetchAllPages<Workspace>("/workspaces");
  },

  create(data: WorkspaceInput): Promise<Workspace> {
    return request<Workspace>("/workspaces", "POST", data);
  },

  update(id: string, data: WorkspaceInput): Promise<Workspace> {
    return request<Workspace>(`/workspaces/${id}`, "PUT", data);
  },

  remove(id: string): Promise<void> {
    return request<void>(`/workspaces/${id}`, "DELETE");
  },

  setImage(id: string, file: File): Promise<Workspace> {
    const body = new FormData();
    body.append("file", file);
    return request<Workspace>(`/workspaces/${id}/icon`, "PUT", body);
  },

  removeImage(id: string): Promise<Workspace> {
    return request<Workspace>(`/workspaces/${id}/icon`, "DELETE");
  },
};

export const categoryApi = {
  list(workspaceId: string): Promise<Category[]> {
    return fetchAllPages<Category>(`/workspaces/${workspaceId}/categories`);
  },

  create(workspaceId: string, data: CategoryInput): Promise<Category> {
    return request<Category>(
      `/workspaces/${workspaceId}/categories`,
      "POST",
      data,
    );
  },

  update(id: string, data: CategoryInput): Promise<Category> {
    return request<Category>(`/categories/${id}`, "PUT", data);
  },

  remove(id: string): Promise<void> {
    return request<void>(`/categories/${id}`, "DELETE");
  },
};

export const channelApi = {
  list(workspaceId: string): Promise<Channel[]> {
    return fetchAllPages<Channel>(`/workspaces/${workspaceId}/channels`);
  },

  listAll(): Promise<Channel[]> {
    return request<Channel[]>("/channels");
  },

  setPinned(id: string, pinned: boolean): Promise<Channel> {
    return request<Channel>(`/channels/${id}/pin`, "PUT", { pinned });
  },

  create(workspaceId: string, data: ChannelInput): Promise<Channel> {
    return request<Channel>(
      `/workspaces/${workspaceId}/channels`,
      "POST",
      data,
    );
  },

  update(id: string, data: ChannelInput): Promise<Channel> {
    return request<Channel>(`/channels/${id}`, "PUT", data);
  },

  remove(id: string): Promise<void> {
    return request<void>(`/channels/${id}`, "DELETE");
  },
};
