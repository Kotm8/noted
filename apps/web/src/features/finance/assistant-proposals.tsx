import { useFinance } from "./api";
import { money } from "./money";
import type { FinanceChange } from "../ai/assistant/types";
import "./finance.css";

export function FinanceProposals({
  changes,
  selected,
  disabled,
  onToggle,
}: {
  changes: FinanceChange[];
  selected: Set<string>;
  disabled: boolean;
  onToggle: (key: string, checked: boolean) => void;
}) {
  const { data: board } = useFinance();
  const amounts = new Set([
    "amount",
    "price",
    "opening_balance",
    "gauge_maximum",
  ]);
  function display(key: string, value: unknown, change: FinanceChange): string {
    if (value == null) return "None";
    if (amounts.has(key) && typeof value === "number")
      return money(
        value,
        change.display_currency || board?.settings.currency || "EUR",
      );
    if (key === "savings_value" && typeof value === "number")
      return (change.display_savings_mode || board?.settings.savings_mode) ===
        "percent"
        ? `${value}%`
        : money(
            value,
            change.display_currency || board?.settings.currency || "EUR",
          );
    if (key.endsWith("account_id") && typeof value === "string")
      return board?.accounts.find((item) => item.id === value)?.name ?? value;
    if (key === "photo_ids" && Array.isArray(value))
      return `${value.length} image${value.length === 1 ? "" : "s"}`;
    if (Array.isArray(value))
      return value.map((item) => display("", item, change)).join("\n\n");
    if (typeof value === "object")
      return Object.entries(value)
        .map(
          ([name, item]) =>
            `${name.replaceAll("_", " ")}: ${display(name, item, change)}`,
        )
        .join("\n");
    return typeof value === "boolean" ? (value ? "Yes" : "No") : String(value);
  }
  return (
    <>
      {changes.map((change, index) => (
        <section className="shared-ai-action" key={`finance-${index}`}>
          <label>
            <input
              type="checkbox"
              checked={selected.has(`finance-${index}`)}
              disabled={disabled}
              onChange={(event) =>
                onToggle(`finance-${index}`, event.target.checked)
              }
            />
            <span>
              {change.operation[0].toUpperCase() + change.operation.slice(1)}{" "}
              {change.entity}:{" "}
              <strong>
                {change.title ||
                  String(
                    (change.fields as Record<string, unknown>)?.name ||
                      change.id ||
                      "Finance",
                  )}
              </strong>
            </span>
          </label>
          <dl className="finance-ai-fields">
            {Object.entries(change.fields ?? {}).map(([key, value]) => (
              <div key={key}>
                <dt>{key.replaceAll("_", " ")}</dt>
                <dd>{display(key, value, change)}</dd>
              </div>
            ))}
          </dl>
          {change.operation === "delete" && (
            <p className="shared-ai-note">
              This record will be deleted when you confirm and apply.
            </p>
          )}
        </section>
      ))}
    </>
  );
}
