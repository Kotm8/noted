import { useDeferredValue, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ChevronLeft,
  ChevronRight,
  Menu,
  Settings2,
  Wallet,
} from "lucide-react";
import { ComicHalftone } from "../../components/ui/comic-halftone";
import { Notice } from "../../components/ui/notice";
import { AssistantButton } from "../ai/assistant/assistant-button";
import { isMobileLayout } from "../../lib/layout";
import { useWorkspaceShell } from "../workspaces/shell-context";
import { useFinance } from "./api";
import { FinanceEditor, type EditorTarget } from "./editor";
import { ProfitGauge } from "./profit-gauge";
import { Savings } from "./savings";
import { UpcomingPayments } from "./payments";
import { Purchases } from "./purchases";
import { Transactions } from "./transactions";
import { ImportDock } from "./import-dock";
import { money, shiftMonth } from "./money";
import "./finance.css";

export function FinancePage() {
  const shell = useWorkspaceShell();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [month, setMonth] = useState<string>();
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const query = useFinance(month, useDeferredValue(search), offset);
  const board = query.data;
  const purchases = params.get("tab") === "purchases";
  useEffect(() => {
    const id = params.get("payment");
    if (!id || !board) return;
    const item = board.items.find(
      (item) => item.id === id && item.kind === "occurrence",
    );
    if (item?.fields.status === "pending")
      setEditor({
        entity: "occurrence",
        id: item.id,
        revision: item.revision,
        operation: "confirm",
        fields: { ...item.fields, day: board.today },
      });
    const next = new URLSearchParams(params);
    next.delete("payment");
    setParams(next, { replace: true });
  }, [board, params, setParams]);
  const settings = () =>
    navigate(
      isMobileLayout() ? "/finance?settings=finance" : "/settings/finance",
    );
  return (
    <>
      <header className="channel-header">
        <ComicHalftone />
        <button
          className="icon-button mobile-menu"
          aria-label="Open navigation"
          onClick={shell.openNavigation}
        >
          <Menu size={20} />
        </button>
        <div className="channel-heading">
          <Wallet size={18} />
          <h1>Finance</h1>
        </div>
        <div className="header-actions">
          <AssistantButton />
          <button
            className="icon-button"
            aria-label="Finance settings"
            onClick={settings}
          >
            <Settings2 size={17} />
          </button>
        </div>
      </header>
      <div className="finance-scroll" ref={scroll}>
        <div className="finance-content">
          <nav
            className="finance-tabs"
            role="tablist"
            aria-label="Finance view"
          >
            {["Tracking", "Planned purchases"].map((label, index) => (
              <button
                key={label}
                role="tab"
                aria-selected={purchases === (index === 1)}
                onClick={() => {
                  const next = new URLSearchParams(params);
                  if (index) next.set("tab", "purchases");
                  else next.delete("tab");
                  scroll.current?.scrollTo({ top: 0, left: 0 });
                  setParams(next, { replace: true });
                }}
              >
                {label}
              </button>
            ))}
          </nav>
          {query.error ? (
            <Notice>{query.error.message}</Notice>
          ) : !board ? (
            <div className="finance-loading" aria-label="Loading Finance" />
          ) : purchases ? (
            <Purchases board={board} onEdit={setEditor} />
          ) : (
            <>
              <div className="finance-month-heading">
                <div>
                  <button
                    className="icon-button"
                    aria-label="Previous month"
                    onClick={() => {
                      setMonth(shiftMonth(board.month, -1));
                      setOffset(0);
                    }}
                  >
                    <ChevronLeft size={17} />
                  </button>
                  <h2>
                    {new Date(`${board.month}T12:00:00`).toLocaleDateString(
                      undefined,
                      { month: "long" },
                    )}
                    <span>{board.month.slice(0, 4)}</span>
                  </h2>
                  <button
                    className="icon-button"
                    aria-label="Next month"
                    onClick={() => {
                      setMonth(shiftMonth(board.month, 1));
                      setOffset(0);
                    }}
                  >
                    <ChevronRight size={17} />
                  </button>
                </div>
                <div className="finance-balance-summary">
                  <div>
                    <span>
                      {board.accounts.length === 1
                        ? board.accounts[0].name
                        : "All accounts"}
                    </span>
                    <strong title="Total balance, including money set aside">
                      {money(board.balance, board.settings.currency)}
                    </strong>
                  </div>
                  <div>
                    <span>Set aside</span>
                    <strong>
                      {money(board.reserved, board.settings.currency)}
                    </strong>
                  </div>
                </div>
              </div>
              <section
                className="finance-account-balances"
                aria-labelledby="finance-account-balances"
              >
                <h3 id="finance-account-balances">Account balances</h3>
                <ul>
                  {board.accounts.map((account) => (
                    <li key={account.id}>
                      <span>
                        {account.name}
                        {account.archived && <small>Archived</small>}
                      </span>
                      <strong>
                        {money(account.balance, board.settings.currency)}
                      </strong>
                      {account.reserved > 0 && (
                        <small>
                          {money(account.available, board.settings.currency)}{" "}
                          available
                        </small>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
              <div className="finance-split">
                <aside className="finance-overview">
                  <ProfitGauge
                    profit={board.profit}
                    maximum={board.settings.gauge_maximum}
                    currency={board.settings.currency}
                  />
                  <div className="finance-income-spent">
                    <div>
                      <span>Income received</span>
                      <strong>
                        {money(board.income, board.settings.currency)}
                      </strong>
                    </div>
                    <div>
                      <span>Spent this month</span>
                      <strong>
                        {money(board.spent, board.settings.currency)}
                      </strong>
                    </div>
                  </div>
                  <Savings board={board} onSettings={settings} />
                  <UpcomingPayments board={board} onEdit={setEditor} />
                </aside>
                <Transactions
                  board={board}
                  search={search}
                  onSearch={(value) => {
                    setSearch(value);
                    setOffset(0);
                  }}
                  onAdd={() => setEditor({ entity: "entry" })}
                  offset={offset}
                  onPage={setOffset}
                />
              </div>
            </>
          )}
        </div>
      </div>
      {board && (
        <>
          <ImportDock board={board} onEdit={setEditor} />
          {editor && (
            <FinanceEditor
              key={`${editor.entity}:${editor.id ?? "new"}:${editor.operation ?? "edit"}:${editor.importContext?.index ?? ""}`}
              board={board}
              target={editor}
              onClose={() => setEditor(null)}
            />
          )}
        </>
      )}
    </>
  );
}
