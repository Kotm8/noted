import { useRef, useState } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../../components/ui/button";
import { Select } from "../../components/ui/select";
import { Notice } from "../../components/ui/notice";
import { ConfirmDialog } from "../../components/ui/confirm-dialog";
import { useFinanceAction } from "./api";
import { minor, money } from "./money";
import {
  itemsOf,
  type FinanceBoard,
  type Item,
  type Reservation,
} from "./types";

export function Savings({
  board,
  onSettings,
}: {
  board: FinanceBoard;
  onSettings: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [amount, setAmount] = useState("");
  const [account, setAccount] = useState(
    board.settings.default_account_id ?? "",
  );
  const [release, setRelease] = useState<Item<Reservation> | null>(null);
  const action = useFinanceAction();
  const request = useRef<string | null>(null);
  const currency = board.settings.currency;
  const reservations = itemsOf<Reservation>(board, "reservation").filter(
    (item) => !item.fields.purchase_id,
  );
  async function save(event: React.FormEvent) {
    event.preventDefault();
    try {
      request.current ??= crypto.randomUUID();
      await action.mutateAsync({
        entity: "reservation",
        operation: "create",
        fields: {
          account_id: account,
          amount: minor(amount),
          day: board.today,
        },
        request_id: request.current,
      });
      setOpen(false);
      setAmount("");
      request.current = null;
      toast.success("Money set aside. No expense created.");
    } catch (error) {
      toast.error((error as Error).message);
    }
  }
  return (
    <section className="finance-savings">
      <div className="finance-section-heading">
        <h2>Monthly savings</h2>
        <Button size="small" variant="secondary" onClick={() => setOpen(true)}>
          Set aside
        </Button>
      </div>
      <div className="finance-savings-values">
        <strong>
          {money(board.reserved, currency, true)}
          <span> of {money(board.savings_goal, currency, true)}</span>
        </strong>
        <span>
          {board.settings.savings_mode === "percent"
            ? `${board.settings.savings_value}% of income`
            : "Fixed monthly target"}
        </span>
      </div>
      <div
        className="finance-progress"
        role="progressbar"
        aria-label="Money set aside"
        aria-valuemin={0}
        aria-valuemax={Math.max(board.savings_goal, board.reserved, 1)}
        aria-valuenow={board.reserved}
      >
        <span
          style={{
            width: `${Math.min(100, (board.reserved / Math.max(1, board.savings_goal)) * 100)}%`,
          }}
        />
      </div>
      <div className="finance-savings-foot">
        <span>
          {money(Math.max(0, board.savings_goal - board.reserved), currency)}{" "}
          left to set aside
        </span>
        <button onClick={onSettings}>Edit target</button>
      </div>
      {open && (
        <form
          className="finance-inline-form finance-form"
          onSubmit={(event) => void save(event)}
        >
          <div className="finance-section-heading">
            <h3>Set money aside</h3>
            <button
              type="button"
              className="icon-button"
              aria-label="Close savings form"
              disabled={action.isPending}
              onClick={() => {
                if (amount.trim()) {
                  setDiscard(true);
                  return;
                }
                setOpen(false);
              }}
            >
              <X size={16} />
            </button>
          </div>
          <label>
            Amount
            <input
              autoFocus
              type="number"
              step="0.01"
              min="0.01"
              required
              value={amount}
              onChange={(event) => {
                setAmount(event.target.value);
                request.current = null;
              }}
            />
          </label>
          {board.accounts.filter((item) => !item.archived).length > 1 && (
            <Select
              label="Savings account"
              value={account}
              options={board.accounts
                .filter((item) => !item.archived)
                .map((item) => ({ value: item.id, label: item.name }))}
              onChange={(value) => {
                setAccount(value);
                request.current = null;
              }}
            />
          )}
          <p>
            {money(
              board.accounts.find((item) => item.id === account)?.available ??
                0,
              currency,
            )}{" "}
            available. This reserves money; it is not an expense.
          </p>
          {action.error && <Notice>{action.error.message}</Notice>}
          <div className="finance-form-actions">
            <Button
              type="button"
              variant="ghost"
              size="small"
              disabled={action.isPending}
              onClick={() => {
                setAmount("");
                setOpen(false);
                request.current = null;
              }}
            >
              Cancel
            </Button>
            <Button size="small" disabled={action.isPending}>
              {action.isPending ? "Saving…" : "Set aside"}
            </Button>
          </div>
        </form>
      )}
      {reservations.length > 0 && (
        <details className="finance-reservations">
          <summary>Manage money set aside</summary>
          {reservations.map((item) => (
            <div key={item.id}>
              <span>
                {
                  board.accounts.find(
                    (account) => account.id === item.fields.account_id,
                  )?.name
                }{" "}
                · {money(item.fields.amount, currency)}
              </span>
              <button onClick={() => setRelease(item)}>Release</button>
            </div>
          ))}
        </details>
      )}
      <ConfirmDialog
        open={discard}
        title="Discard savings amount?"
        description="This amount has not been set aside."
        keepLabel="Keep editing"
        confirmLabel="Discard"
        onClose={() => setDiscard(false)}
        onConfirm={() => {
          setDiscard(false);
          setAmount("");
          setOpen(false);
          request.current = null;
        }}
      />
      <ConfirmDialog
        open={Boolean(release)}
        onClose={() => setRelease(null)}
        keepLabel="Keep reserved"
        title="Release this reservation?"
        description="The money becomes available again. This does not create income."
        pending={action.isPending}
        confirmLabel="Release"
        onConfirm={() => {
          if (release)
            action.mutate(
              {
                entity: "reservation",
                operation: "delete",
                id: release.id,
                revision: release.revision,
              },
              { onSuccess: () => setRelease(null) },
            );
        }}
      />
    </section>
  );
}
