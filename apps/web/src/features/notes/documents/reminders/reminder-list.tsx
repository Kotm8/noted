import { ContextMenu } from "../../../../components/ui/context-menu";
import { MenuItem } from "../../../../components/ui/menu";
import { useLayoutEffect, useState } from "react";
import { AlarmClock, Bell, Trash2 } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { ConfirmDialog } from "../../../../components/ui/confirm-dialog";
import { Notice } from "../../../../components/ui/notice";
import type { useDocumentReminders } from "./use-document-reminders";
import type { DocumentReminder } from "./api";
import "./reminders.css";

export function DocumentReminderList({
  controller,
}: {
  controller: ReturnType<typeof useDocumentReminders>;
}) {
  const [params] = useSearchParams();
  const requested = params.get("documentReminder");
  const [removing, setRemoving] = useState<DocumentReminder | null>(null);
  useLayoutEffect(() => {
    if (requested)
      document
        .getElementById(`reminder-${requested}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [requested, controller.items]);
  if (controller.query.isError)
    return (
      <Notice tone="error">
        Reminders could not load.{" "}
        <button onClick={() => void controller.query.refetch()}>Retry</button>
      </Notice>
    );
  if (!controller.items.length) return null;
  return (
    <section className="document-reminders" aria-label="Note reminders">
      {controller.items.map((item) => (
        <ContextMenu
          key={item.id}
          disabled={controller.pending}
          label={`Actions for reminder ${item.name}`}
          menu={
            <>
              <MenuItem onSelect={() => controller.edit(item)}>
                Change reminder time
              </MenuItem>
              <MenuItem
                onSelect={() =>
                  controller.act(
                    item,
                    item.status === "done" ? "restore" : "done",
                  )
                }
              >
                {item.status === "done"
                  ? "Restore reminder"
                  : "Complete reminder"}
              </MenuItem>
              {item.status === "active" && (
                <MenuItem onSelect={() => controller.act(item, "snooze")}>
                  Snooze reminder
                </MenuItem>
              )}
              <MenuItem danger onSelect={() => setRemoving(item)}>
                Remove reminder
              </MenuItem>
            </>
          }
        >
          <div
            id={`reminder-${item.id}`}
            className={`document-reminder${controller.completed.has(item.id) ? " is-done" : ""}${item.id === requested ? " is-target" : ""}`}
          >
            <input
              type="checkbox"
              aria-label={`Complete ${item.name}`}
              checked={controller.checked[item.id] ?? item.status === "done"}
              disabled={controller.pending}
              onChange={() =>
                controller.act(
                  item,
                  item.status === "done" ? "restore" : "done",
                )
              }
            />
            <button
              className="document-reminder-label"
              onClick={() => controller.edit(item)}
            >
              <Bell size={14} />
              <strong>{item.name}</strong>
              <time dateTime={item.due_at}>
                {new Date(item.due_at).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                  hourCycle: "h23",
                })}
              </time>
              {item.repeat !== "none" && <small>{item.repeat}</small>}
            </button>
            {item.status === "active" && (
              <button
                className="icon-button"
                aria-label={`Snooze ${item.name}`}
                title="Snooze"
                disabled={controller.pending}
                onClick={() => controller.act(item, "snooze")}
              >
                <AlarmClock size={15} />
              </button>
            )}
            <button
              className="icon-button"
              aria-label={`Remove reminder ${item.name}`}
              title="Remove reminder"
              disabled={controller.pending}
              onClick={() => setRemoving(item)}
            >
              <Trash2 size={14} />
            </button>
          </div>
        </ContextMenu>
      ))}
      <ConfirmDialog
        open={removing !== null}
        title="Remove reminder"
        description="This cancels the reminder. Your note text stays in place."
        keepLabel="Keep reminder"
        confirmLabel="Remove reminder"
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          if (removing) controller.act(removing, "remove");
          setRemoving(null);
        }}
      />
    </section>
  );
}
