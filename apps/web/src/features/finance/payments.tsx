import { Plus } from "lucide-react";
import { itemsOf, type FinanceBoard, type Occurrence } from "./types";
import { dateLabel, money } from "./money";
import type { EditorTarget } from "./editor";

export function UpcomingPayments({
  board,
  onEdit,
}: {
  board: FinanceBoard;
  onEdit: (target: EditorTarget) => void;
}) {
  const upcoming = itemsOf<Occurrence>(board, "occurrence")
    .filter((item) => item.fields.status === "pending")
    .sort((a, b) => a.fields.due_on.localeCompare(b.fields.due_on));
  return (
    <section className="finance-upcoming">
      <div className="finance-section-heading">
        <h2>Upcoming payments</h2>
        <button
          className="icon-button"
          aria-label="Add recurring payment"
          onClick={() => onEdit({ entity: "payment" })}
        >
          <Plus size={16} />
        </button>
      </div>
      {!upcoming.length && (
        <p className="finance-empty">No upcoming payments.</p>
      )}
      {upcoming.slice(0, 8).map((item) => (
        <div className="finance-payment" key={item.id}>
          <time dateTime={item.fields.due_on}>
            {dateLabel(item.fields.due_on)}
          </time>
          <div>
            <strong>{item.fields.name}</strong>
            <span>
              {item.fields.due_on < board.today
                ? "Overdue"
                : item.fields.confirm === false
                  ? "Records automatically"
                  : "Pending confirmation"}
            </span>
          </div>
          <div>
            <strong>
              {money(item.fields.amount, board.settings.currency)}
            </strong>
            <button
              onClick={() =>
                onEdit({
                  entity: "occurrence",
                  id: item.id,
                  revision: item.revision,
                  operation: "confirm",
                  fields: { ...item.fields, day: board.today },
                })
              }
            >
              {item.fields.confirm === false ? "Record now" : "Confirm"}
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}
