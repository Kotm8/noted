import {
  ArrowDownLeft,
  ArrowRightLeft,
  ArrowUpRight,
  Plus,
  Receipt,
  Search,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import { money, dateLabel } from "./money";
import type { FinanceBoard, Entry } from "./types";

export function Transactions({
  board,
  search,
  onSearch,
  onAdd,
  offset,
  onPage,
}: {
  board: FinanceBoard;
  search: string;
  onSearch: (text: string) => void;
  onAdd: () => void;
  offset: number;
  onPage: (offset: number) => void;
}) {
  const groups = new Map<string, Entry[]>();
  for (const item of board.entries)
    groups.set(item.day, [...(groups.get(item.day) ?? []), item]);
  return (
    <section className="finance-ledger" aria-label="Transactions">
      <div className="finance-section-heading">
        <h2>Recent transactions</h2>
        <div>
          <label className="finance-search">
            <Search size={15} />
            <input
              type="search"
              placeholder="Search"
              aria-label="Search transactions"
              value={search}
              onChange={(event) => onSearch(event.target.value)}
            />
          </label>
          <Button variant="secondary" size="small" onClick={onAdd}>
            <Plus size={14} />
            Add
          </Button>
        </div>
      </div>
      {board.entries.length === 0 && (
        <p className="finance-empty">
          {search ? "No matching transactions." : "No transactions this month."}
        </p>
      )}
      {[...groups].map(([day, entries]) => (
        <section className="finance-transaction-day" key={day}>
          <div className="finance-date-heading">
            <span>{day === board.today ? "Today" : dateLabel(day)}</span>
            <span>
              {money(
                entries.reduce(
                  (sum, item) =>
                    sum +
                    (item.kind === "income"
                      ? item.amount
                      : item.kind === "expense"
                        ? -item.amount
                        : 0),
                  0,
                ),
                board.settings.currency,
              )}
            </span>
          </div>
          {entries.map((item) => (
            <div className="finance-transaction-row" key={item.id}>
              <span className="finance-transaction-icon">
                {item.kind === "transfer" ? (
                  <ArrowRightLeft size={17} />
                ) : item.kind === "income" ? (
                  <ArrowDownLeft size={17} />
                ) : (
                  <ArrowUpRight size={17} />
                )}
              </span>
              <div>
                <strong>{item.name}</strong>
                <span>
                  {item.category}
                  {board.accounts.length > 1
                    ? ` · ${board.accounts.find((account) => account.id === item.account_id)?.name ?? "Account"}`
                    : ""}
                  {item.import_id ? " · From screenshot" : ""}
                  {item.photo_ids.length > 0 && (
                    <Receipt size={12} aria-label="Has receipt" />
                  )}
                </span>
              </div>
              <strong
                className={item.kind === "income" ? "finance-incoming" : ""}
              >
                {item.kind === "income"
                  ? "+"
                  : item.kind === "expense"
                    ? "−"
                    : ""}
                {money(item.amount, board.settings.currency)}
              </strong>
            </div>
          ))}
        </section>
      ))}
      {board.total_entries > 100 && (
        <nav className="finance-pagination" aria-label="Transaction pages">
          <Button
            size="small"
            variant="ghost"
            disabled={offset === 0}
            onClick={() => onPage(Math.max(0, offset - 100))}
          >
            Previous
          </Button>
          <span>
            {offset + 1}–{Math.min(offset + 100, board.total_entries)} of{" "}
            {board.total_entries}
          </span>
          <Button
            size="small"
            variant="ghost"
            disabled={offset + 100 >= board.total_entries}
            onClick={() => onPage(offset + 100)}
          >
            Next
          </Button>
        </nav>
      )}
    </section>
  );
}
