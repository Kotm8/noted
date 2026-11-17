import { useEffect, useRef, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../../components/ui/button";
import { Select } from "../../components/ui/select";
import { DatePicker } from "../../components/ui/date-picker";
import { ConfirmDialog } from "../../components/ui/confirm-dialog";
import { Notice } from "../../components/ui/notice";
import { useFinance, useFinanceAction } from "./api";
import { FinanceEditor, type EditorTarget } from "./editor";
import { money, minor } from "./money";
import {
  itemsOf,
  type Account,
  type FinanceBoard,
  type FinanceSettings,
  type Payment,
  type Occurrence,
} from "./types";
import "./finance.css";
import "./settings.css";

function AccountForm({
  account,
  onClose,
}: {
  account?: Account;
  onClose: () => void;
}) {
  const [name, setName] = useState(account?.name ?? "");
  const [opening, setOpening] = useState(
    ((account?.opening_balance ?? 0) / 100).toFixed(2),
  );
  const action = useFinanceAction();
  const attempt = useRef<string | null>(null);
  return (
    <form
      className="finance-inline-form finance-form"
      onSubmit={async (event) => {
        event.preventDefault();
        try {
          attempt.current ??= crypto.randomUUID();
          await action.mutateAsync({
            entity: "account",
            operation: account ? "update" : "create",
            id: account?.id,
            revision: account?.revision,
            fields: { name, opening_balance: minor(opening) },
            request_id: attempt.current,
          });
          onClose();
        } catch (error) {
          toast.error((error as Error).message);
        }
      }}
    >
      <label>
        Name
        <input
          required
          maxLength={80}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            attempt.current = null;
          }}
        />
      </label>
      <label>
        Opening balance
        <input
          required
          type="number"
          step="0.01"
          value={opening}
          onChange={(event) => {
            setOpening(event.target.value);
            attempt.current = null;
          }}
        />
      </label>
      <div className="finance-form-actions">
        <Button size="small" variant="ghost" type="button" onClick={onClose}>
          Cancel
        </Button>
        <Button size="small" disabled={action.isPending}>
          Save account
        </Button>
      </div>
    </form>
  );
}

function SettingsForm({ board }: { board: FinanceBoard }) {
  const [settings, setSettings] = useState<FinanceSettings>(board.settings);
  const [gauge, setGauge] = useState(
    (board.settings.gauge_maximum / 100).toFixed(2),
  );
  const [savings, setSavings] = useState(
    String(
      board.settings.savings_mode === "percent"
        ? board.settings.savings_value
        : board.settings.savings_value / 100,
    ),
  );
  const [categories, setCategories] = useState(
    board.settings.categories.join(", "),
  );
  const [dirty, setDirty] = useState(false);
  const [accountForm, setAccountForm] = useState<Account | "new" | null>(null);
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const action = useFinanceAction();
  const attempt = useRef<string | null>(null);
  useEffect(() => {
    if (!dirty) return;
    const prevent = (event: Event) => event.preventDefault();
    const leave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("noted:before-settings-navigation", prevent);
    window.addEventListener("beforeunload", leave);
    return () => {
      window.removeEventListener("noted:before-settings-navigation", prevent);
      window.removeEventListener("beforeunload", leave);
    };
  }, [dirty]);
  function change(key: keyof FinanceSettings, value: unknown) {
    setSettings((current) => ({ ...current, [key]: value }));
    setDirty(true);
    attempt.current = null;
  }
  const payments = itemsOf<Payment>(board, "payment");
  const occurrences = itemsOf<Occurrence>(board, "occurrence").filter(
    (item) => item.fields.status === "pending",
  );
  return (
    <>
      <form
        className="finance-settings-form"
        onSubmit={async (event) => {
          event.preventDefault();
          try {
            const { revision, ...fields } = settings;
            attempt.current ??= crypto.randomUUID();
            const result = await action.mutateAsync({
              entity: "settings",
              operation: "update",
              revision,
              fields: {
                ...fields,
                gauge_maximum: minor(gauge),
                savings_value:
                  settings.savings_mode === "percent"
                    ? Number(savings)
                    : minor(savings),
                categories: categories
                  .split(",")
                  .map((item) => item.trim())
                  .filter(Boolean),
              },
              request_id: attempt.current,
            });
            setSettings((current) => ({
              ...current,
              revision: result.revision,
            }));
            setDirty(false);
            attempt.current = null;
            toast.success("Finance settings saved");
          } catch (error) {
            toast.error((error as Error).message);
          }
        }}
      >
        <section>
          <h3>Money</h3>
          <div className="finance-settings-grid">
            <div className="finance-field">
              <span>Currency</span>
              <Select
                label="Finance currency"
                value={settings.currency}
                options={["EUR", "USD", "GBP", "RUB"].map((value) => ({
                  value,
                  label: value,
                }))}
                onChange={(value) => change("currency", value)}
              />
            </div>
            <label>
              Profit / loss gauge maximum
              <input
                aria-label="Profit / loss gauge maximum"
                required
                type="number"
                min="0.01"
                step="0.01"
                value={gauge}
                onChange={(event) => {
                  setGauge(event.target.value);
                  setDirty(true);
                  attempt.current = null;
                }}
              />
              <span>
                Sets both the negative and positive ends of the gauge.
              </span>
            </label>
            <div className="finance-field">
              <span>Monthly savings</span>
              <Select
                label="Savings target type"
                value={settings.savings_mode}
                options={[
                  { value: "fixed", label: "Fixed amount" },
                  { value: "percent", label: "Percentage of received income" },
                ]}
                onChange={(value) => {
                  change("savings_mode", value);
                  setSavings("0");
                }}
              />
            </div>
            <label>
              {settings.savings_mode === "percent"
                ? "Percent of income"
                : "Monthly amount"}
              <input
                required
                type="number"
                min="0"
                step={settings.savings_mode === "percent" ? "1" : "0.01"}
                max={settings.savings_mode === "percent" ? 100 : undefined}
                value={savings}
                onChange={(event) => {
                  setSavings(event.target.value);
                  setDirty(true);
                  attempt.current = null;
                }}
              />
            </label>
            <label className="finance-wide">
              Categories, separated by commas
              <input
                value={categories}
                maxLength={8000}
                onChange={(event) => {
                  setCategories(event.target.value);
                  setDirty(true);
                  attempt.current = null;
                }}
              />
            </label>
            <div className="finance-field">
              <span>Default account</span>
              <Select
                label="Default Finance account"
                value={settings.default_account_id ?? ""}
                options={board.accounts
                  .filter((item) => !item.archived)
                  .map((item) => ({ value: item.id, label: item.name }))}
                onChange={(value) => change("default_account_id", value)}
              />
            </div>
          </div>
        </section>
        <section>
          <h3>Payment reminders</h3>
          <div className="finance-settings-grid">
            <div className="finance-field">
              <span>Default notification</span>
              <Select
                label="Default payment reminder"
                value={
                  settings.payment_reminder_days == null
                    ? "off"
                    : String(settings.payment_reminder_days)
                }
                options={[
                  { value: "off", label: "Off" },
                  { value: "0", label: "On the due date" },
                  { value: "1", label: "1 day before" },
                  { value: "3", label: "3 days before" },
                  { value: "7", label: "1 week before" },
                ]}
                onChange={(value) =>
                  change(
                    "payment_reminder_days",
                    value === "off" ? null : Number(value),
                  )
                }
              />
            </div>
            <div className="finance-field">
              <span>Notification time</span>
              <Select
                label="Payment reminder time"
                value={String(settings.reminder_minute)}
                options={Array.from({ length: 96 }, (_, index) => ({
                  value: String(index * 15),
                  label: `${String(Math.floor(index / 4)).padStart(2, "0")}:${String((index % 4) * 15).padStart(2, "0")}`,
                }))}
                onChange={(value) => change("reminder_minute", Number(value))}
              />
            </div>
          </div>
          <p>
            Uses your calendar timezone and existing device notification
            preferences.
          </p>
        </section>
        <section>
          <div className="finance-section-heading">
            <h3>Paydays</h3>
            <Button
              type="button"
              size="small"
              variant="secondary"
              onClick={() =>
                change("paydays", [
                  ...settings.paydays,
                  { name: "Salary", day: 1, amount: 0, delayed_until: null },
                ])
              }
              disabled={settings.paydays.length >= 12}
            >
              <Plus size={14} />
              Add payday
            </Button>
          </div>
          {settings.paydays.length === 0 && <p>No paydays configured.</p>}
          {settings.paydays.map((item, index) => (
            <div className="finance-payday-fields" key={index}>
              <label>
                Name
                <input
                  required
                  maxLength={80}
                  value={item.name}
                  onChange={(event) =>
                    change(
                      "paydays",
                      settings.paydays.map((row, i) =>
                        i === index
                          ? { ...row, name: event.target.value }
                          : row,
                      ),
                    )
                  }
                />
              </label>
              <label>
                Day of month
                <input
                  type="number"
                  min={1}
                  max={31}
                  required
                  value={item.day}
                  onChange={(event) =>
                    change(
                      "paydays",
                      settings.paydays.map((row, i) =>
                        i === index
                          ? { ...row, day: Number(event.target.value) }
                          : row,
                      ),
                    )
                  }
                />
              </label>
              <label>
                Expected amount
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={item.amount / 100}
                  onChange={(event) =>
                    change(
                      "paydays",
                      settings.paydays.map((row, i) =>
                        i === index
                          ? {
                              ...row,
                              amount: Math.round(
                                Number(event.target.value) * 100,
                              ),
                            }
                          : row,
                      ),
                    )
                  }
                />
              </label>
              <div className="finance-field">
                <span>Delayed until (optional)</span>
                <DatePicker
                  label={`Delayed ${item.name} date`}
                  value={item.delayed_until ?? ""}
                  optional
                  onChange={(value) =>
                    change(
                      "paydays",
                      settings.paydays.map((row, i) =>
                        i === index
                          ? { ...row, delayed_until: value || null }
                          : row,
                      ),
                    )
                  }
                />
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label={`Remove payday ${index + 1}`}
                onClick={() =>
                  change(
                    "paydays",
                    settings.paydays.filter((_, i) => i !== index),
                  )
                }
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
          <p>
            Expected salary stays separate from received income. Late payments
            use their actual receipt date.
          </p>
        </section>
        {action.error && <Notice>{action.error.message}</Notice>}
        <Button disabled={action.isPending || !dirty}>
          {action.isPending ? "Saving…" : "Save settings"}
        </Button>
      </form>
      <section className="finance-settings-section">
        <div className="finance-section-heading">
          <h3>Accounts</h3>
          <Button
            size="small"
            variant="secondary"
            onClick={() => setAccountForm("new")}
          >
            <Plus size={14} />
            Add account
          </Button>
        </div>
        {board.accounts.map((account) => (
          <div className="finance-settings-row" key={account.id}>
            <div>
              <strong>
                {account.name}
                {account.archived ? " (archived)" : ""}
              </strong>
              <span>
                {money(account.balance, board.settings.currency)} balance ·{" "}
                {money(account.available, board.settings.currency)} available
              </span>
            </div>
            <button
              className="icon-button"
              aria-label={`Edit ${account.name}`}
              onClick={() => setAccountForm(account)}
            >
              <Pencil size={15} />
            </button>
            <Button
              size="small"
              variant="ghost"
              disabled={action.isPending}
              onClick={() =>
                action.mutate({
                  entity: "account",
                  operation: "update",
                  id: account.id,
                  revision: account.revision,
                  fields: { archived: !account.archived },
                })
              }
            >
              {account.archived ? "Unarchive" : "Archive"}
            </Button>
          </div>
        ))}
        {accountForm && (
          <AccountForm
            key={accountForm === "new" ? "new" : accountForm.id}
            account={accountForm === "new" ? undefined : accountForm}
            onClose={() => setAccountForm(null)}
          />
        )}
      </section>
      <section className="finance-settings-section">
        <div className="finance-section-heading">
          <h3>Recurring payments</h3>
          <Button
            size="small"
            variant="secondary"
            onClick={() => setEditor({ entity: "payment" })}
          >
            <Plus size={14} />
            Add payment
          </Button>
        </div>
        {payments.map((item) => (
          <div className="finance-settings-row" key={item.id}>
            <div>
              <strong>
                {item.fields.name}
                {item.fields.archived ? " (archived)" : ""}
              </strong>
              <span>
                {money(item.fields.amount, board.settings.currency)} every{" "}
                {item.fields.interval} {item.fields.unit}
                {item.fields.interval === 1 ? "" : "s"} ·{" "}
                {item.fields.confirm
                  ? "Ask for confirmation"
                  : "Record automatically"}
              </span>
            </div>
            <button
              className="icon-button"
              aria-label={`Edit payment ${item.fields.name}`}
              onClick={() =>
                setEditor({
                  entity: "payment",
                  id: item.id,
                  revision: item.revision,
                  fields: { ...item.fields },
                })
              }
            >
              <Pencil size={15} />
            </button>
            <Button
              size="small"
              variant="ghost"
              disabled={action.isPending}
              onClick={() =>
                action.mutate({
                  entity: "payment",
                  operation: "update",
                  id: item.id,
                  revision: item.revision,
                  fields: { archived: !item.fields.archived },
                })
              }
            >
              {item.fields.archived ? "Unarchive" : "Archive"}
            </Button>
          </div>
        ))}
        {occurrences.length > 0 && (
          <details>
            <summary>Pending occurrences</summary>
            {occurrences.slice(0, 30).map((item) => (
              <div className="finance-settings-row" key={item.id}>
                <span>
                  {item.fields.name} · {item.fields.due_on}
                </span>
                <Button
                  size="small"
                  variant="ghost"
                  disabled={action.isPending}
                  onClick={() =>
                    action.mutate({
                      entity: "occurrence",
                      operation: "skip",
                      id: item.id,
                      revision: item.revision,
                    })
                  }
                >
                  Skip this occurrence
                </Button>
              </div>
            ))}
          </details>
        )}
      </section>
      <LedgerManager />
      {editor && (
        <FinanceEditor
          key={editor.id ?? "new"}
          board={board}
          target={editor}
          onClose={() => setEditor(null)}
        />
      )}
    </>
  );
}

function LedgerManager() {
  const [month, setMonth] = useState("");
  const [offset, setOffset] = useState(0);
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const query = useFinance(month ? `${month}-01` : undefined, "", offset);
  const board = query.data;
  const action = useFinanceAction();
  const target = board?.entries.find((item) => item.id === deleting);
  return (
    <details className="finance-settings-section">
      <summary>Manage transactions</summary>
      <label className="finance-ledger-month">
        Month
        <input
          type="month"
          value={month || board?.month.slice(0, 7) || ""}
          onChange={(event) => {
            setMonth(event.target.value);
            setOffset(0);
          }}
        />
      </label>
      {board?.entries.map((item) => (
        <div className="finance-settings-row" key={item.id}>
          <div>
            <strong>{item.name}</strong>
            <span>
              {item.day} · {money(item.amount, board.settings.currency)}
            </span>
          </div>
          <button
            className="icon-button"
            aria-label={`Edit transaction ${item.name}`}
            onClick={() =>
              setEditor({
                entity: "entry",
                id: item.id,
                revision: item.revision,
                fields: { ...item },
              })
            }
          >
            <Pencil size={15} />
          </button>
          <button
            className="icon-button"
            aria-label={`Delete transaction ${item.name}`}
            onClick={() => setDeleting(item.id)}
          >
            <Trash2 size={15} />
          </button>
        </div>
      ))}
      {board && board.total_entries > 100 && (
        <nav
          className="finance-pagination"
          aria-label="Manage transaction pages"
        >
          <Button
            size="small"
            variant="ghost"
            disabled={!offset}
            onClick={() => setOffset(Math.max(0, offset - 100))}
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
            onClick={() => setOffset(offset + 100)}
          >
            Next
          </Button>
        </nav>
      )}
      {editor && board && (
        <FinanceEditor
          board={board}
          target={editor}
          onClose={() => setEditor(null)}
        />
      )}
      <ConfirmDialog
        open={Boolean(target)}
        onClose={() => setDeleting(null)}
        keepLabel="Keep transaction"
        title="Delete this transaction?"
        description="Its amount will be removed from the ledger. Linked purchases or payment occurrences will reopen."
        confirmLabel="Delete transaction"
        pending={action.isPending}
        onConfirm={() => {
          if (target)
            action.mutate(
              {
                entity: "entry",
                operation: "delete",
                id: target.id,
                revision: target.revision,
              },
              {
                onSuccess: (result) => {
                  setDeleting(null);
                  toast.success("Transaction deleted", {
                    action: {
                      label: "Undo",
                      onClick: () =>
                        action.mutate({
                          entity: "entry",
                          operation: "restore",
                          id: result.id,
                          revision: result.revision,
                        }),
                    },
                  });
                },
              },
            );
        }}
      />
    </details>
  );
}

export function FinanceSettingsPanel() {
  const query = useFinance();
  return (
    <section className="finance-settings">
      <h2>Finance</h2>
      <p>Accounts, savings, recurring payments and the profit / loss gauge.</p>
      {query.error ? (
        <Notice>{query.error.message}</Notice>
      ) : query.data ? (
        <SettingsForm board={query.data} />
      ) : (
        <p>Loading settings…</p>
      )}
    </section>
  );
}
