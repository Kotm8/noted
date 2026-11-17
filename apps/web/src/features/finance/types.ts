export interface FinanceSettings {
  currency: "EUR" | "USD" | "GBP" | "RUB";
  gauge_maximum: number;
  savings_mode: "fixed" | "percent";
  savings_value: number;
  payment_reminder_days: number | null;
  reminder_minute: number;
  categories: string[];
  paydays: {
    name: string;
    day: number;
    amount: number;
    delayed_until: string | null;
  }[];
  default_account_id: string | null;
  revision: number;
}
export interface Account {
  id: string;
  name: string;
  opening_balance: number;
  archived: boolean;
  revision: number;
  balance: number;
  reserved: number;
  available: number;
}
export interface Entry {
  id: string;
  account_id: string;
  target_account_id: string | null;
  kind: "income" | "expense" | "transfer";
  amount: number;
  day: string;
  name: string;
  category: string;
  notes: string;
  photo_ids: string[];
  payday_date: string | null;
  revision: number;
  import_id: string | null;
  occurrence_id: string | null;
}
export interface Purchase {
  name: string;
  price: number;
  priority: "Low" | "Medium" | "High";
  target_date: string | null;
  notes: string;
  link: string;
  photo_ids: string[];
  status: "considering" | "saving" | "bought";
  entry_id: string | null;
}
export interface Reservation {
  account_id: string;
  purchase_id: string | null;
  amount: number;
  day: string;
}
export interface Payment {
  name: string;
  account_id: string;
  amount: number;
  category: string;
  starts_on: string;
  unit: "day" | "week" | "month" | "year";
  interval: number;
  confirm: boolean;
  archived: boolean;
}
export interface Occurrence {
  confirm?: boolean;
  payment_id: string;
  due_on: string;
  name: string;
  account_id: string;
  amount: number;
  category: string;
  status: "pending" | "paid" | "skipped";
  entry_id: string | null;
}
export interface Item<T = Record<string, unknown>> {
  id: string;
  kind: "purchase" | "reservation" | "payment" | "occurrence" | "import";
  fields: T;
  revision: number;
}
export type Entity = "settings" | "account" | "entry" | Item["kind"];
export interface FinanceAction {
  entity: Entity;
  operation:
    | "create"
    | "update"
    | "delete"
    | "restore"
    | "buy"
    | "confirm"
    | "skip"
    | "undo";
  id?: string | null;
  revision?: number | null;
  fields?: object;
  request_id?: string;
}
export interface FinanceBoard {
  settings: FinanceSettings;
  accounts: Account[];
  month: string;
  today: string;
  income: number;
  spent: number;
  profit: number;
  balance: number;
  reserved: number;
  available: number;
  savings_goal: number;
  entries: Entry[];
  total_entries: number;
  items: Item[];
}
export function itemsOf<T>(board: FinanceBoard, kind: Item["kind"]): Item<T>[] {
  return board.items.filter((item) => item.kind === kind) as Item<T>[];
}
