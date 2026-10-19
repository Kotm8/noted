export interface HomeActivity {
  kind: "reminder" | "plan" | "writing";
  id: string;
  revision: number;
  title: string;
  due_at: string;
  read: boolean;
  workspace_id: string | null;
  workspace_name: string | null;
  channel_id: string | null;
  channel_name: string | null;
}

export interface HomeActivityPage {
  items: HomeActivity[];
  has_more: boolean;
}
