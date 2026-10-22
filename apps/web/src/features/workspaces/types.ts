export interface Workspace {
  id: string;
  name: string;
  icon: string;
  icon_url: string | null;
  position: number;
  created_at: string;
}

export interface Category {
  id: string;
  workspace_id: string;
  name: string;
  position: number;
}

export interface Channel {
  kind?: "note" | "reminder" | "journal" | "document";
  id: string;
  workspace_id: string;
  category_id: string | null;
  name: string;
  banner_url: string | null;
  position: number;
  created_at: string;
}

export interface WorkspaceInput {
  name: string;
  icon: string;
  position: number;
}

export interface CategoryInput {
  name: string;
  position: number;
}

export interface ChannelInput extends CategoryInput {
  kind?: "note" | "reminder" | "journal" | "document";
  category_id: string | null;
}

export type ManagementAction =
  | {
      kind: "workspace";
      item?: Workspace;
      deleting?: boolean;
    }
  | {
      kind: "category";
      workspaceId: string;
      item?: Category;
      deleting?: boolean;
    }
  | {
      kind: "channel";
      workspaceId: string;
      item?: Channel;
      categoryId?: string | null;
      deleting?: boolean;
    };

export type OpenManagement = (action: ManagementAction) => void;

export interface SidebarMove {
  kind: "channel" | "category";
  id: string;
  before_id: string | null;
  category_id?: string | null;
}

export interface SidebarOrder {
  categories: Category[];
  channels: Channel[];
}
