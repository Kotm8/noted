import { useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "../../components/ui/dialog";
import { ConfirmDialog } from "../../components/ui/confirm-dialog";
import { Button } from "../../components/ui/button";
import { Select } from "../../components/ui/select";
import { DatePicker } from "../../components/ui/date-picker";
import { Notice } from "../../components/ui/notice";
import { financeApi, photoUrl, useFinanceAction } from "./api";
import { minor } from "./money";
import type { FinanceBoard, FinanceAction, Entity } from "./types";

export interface EditorTarget {
  entity: Exclude<Entity, "settings" | "import">;
  id?: string;
  revision?: number;
  fields?: Record<string, unknown>;
  operation?: FinanceAction["operation"];
  importContext?: {
    id: string;
    revision: number;
    index: number;
    occurrenceIds: string[];
  };
}

export function FinanceEditor({
  board,
  target,
  onClose,
}: {
  board: FinanceBoard;
  target: EditorTarget;
  onClose: () => void;
}) {
  const original = target.fields ?? {};
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries({
        name: "",
        account_id: board.settings.default_account_id ?? "",
        kind: "expense",
        category: "Other",
        day: board.today,
        starts_on: board.today,
        unit: "month",
        interval: "1",
        priority: "Medium",
        link: "",
        notes: "",
        target_date: "",
        purchase_id: "",
        entry_id: "",
        ...original,
        amount:
          original.amount == null
            ? ""
            : (Number(original.amount) / 100).toFixed(2),
        price:
          original.price == null
            ? ""
            : (Number(original.price) / 100).toFixed(2),
        confirm: original.confirm === false ? "no" : "yes",
      }).map(([key, value]) => [key, String(value ?? "")]),
    ),
  );
  const [photos, setPhotos] = useState<string[]>(
    (original.photo_ids as string[]) ?? [],
  );
  const [dirty, setDirty] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [uploading, setUploading] = useState(false);
  const action = useFinanceAction();
  const request = useRef<string | null>(null);
  const pending = uploading || action.isPending;
  const entity = target.entity;
  const resolving =
    target.operation === "buy" || target.operation === "confirm";
  const update = (key: string, value: string) => {
    setValues((current) => ({ ...current, [key]: value }));
    setDirty(true);
    request.current = null;
  };
  const title = resolving
    ? target.operation === "buy"
      ? "Mark bought"
      : "Confirm payment"
    : `${target.id ? "Edit" : "Add"} ${entity === "entry" ? "transaction" : entity === "payment" ? "recurring payment" : entity}`;
  function close() {
    if (pending) return;
    if (dirty) setDiscard(true);
    else onClose();
  }
  const field = (
    label: string,
    key: string,
    type = "text",
    required = true,
  ) => (
    <label>
      {label}
      <input
        name={key}
        type={type}
        required={required}
        maxLength={key === "name" ? 200 : undefined}
        inputMode={type === "number" ? "decimal" : undefined}
        step={type === "number" ? "0.01" : undefined}
        min={type === "number" ? "0.01" : undefined}
        value={values[key] ?? ""}
        onChange={(event) => update(key, event.target.value)}
      />
    </label>
  );
  const select = (
    label: string,
    key: string,
    options: { value: string; label: string }[],
  ) => (
    <div className="finance-field">
      <span>{label}</span>
      <Select
        label={label}
        value={values[key] ?? ""}
        options={options}
        onChange={(value) => update(key, value)}
      />
    </div>
  );
  const dateField = (label: string, key: string, optional = false) => (
    <div className="finance-field">
      <span>{label}</span>
      <DatePicker
        label={label}
        value={values[key] ?? ""}
        optional={optional}
        onChange={(value) => update(key, value)}
      />
    </div>
  );
  const accounts = board.accounts
    .filter((item) => !item.archived || item.id === values.account_id)
    .map((item) => ({ value: item.id, label: item.name }));
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    try {
      let fields: object;
      if (resolving)
        fields = values.entry_id
          ? { entry_id: values.entry_id }
          : {
              amount: minor(values.amount || values.price),
              day: values.day,
              account_id: values.account_id,
            };
      else if (entity === "entry")
        fields = {
          name: values.name,
          amount: minor(values.amount),
          kind: values.kind,
          account_id: values.account_id,
          target_account_id:
            values.kind === "transfer" ? values.target_account_id : null,
          category: values.category,
          day: values.day,
          notes: values.notes,
          photo_ids: photos,
          payday_date: values.payday_date || null,
        };
      else if (entity === "purchase")
        fields = {
          name: values.name,
          price: minor(values.price),
          priority: values.priority,
          target_date: values.target_date || null,
          link: values.link,
          notes: values.notes,
          photo_ids: photos,
        };
      else if (entity === "payment")
        fields = {
          name: values.name,
          amount: minor(values.amount),
          account_id: values.account_id,
          category: values.category,
          starts_on: values.starts_on,
          unit: values.unit,
          interval: Number(values.interval),
          confirm: values.confirm === "yes",
          reminder_days:
            values.reminder_days === "off"
              ? -1
              : values.reminder_days
                ? Number(values.reminder_days)
                : null,
        };
      else if (entity === "reservation")
        fields = {
          amount: minor(values.amount),
          account_id: values.account_id,
          day: values.day,
          purchase_id: values.purchase_id || null,
        };
      else throw new Error("Choose a Finance action.");
      request.current ??= crypto.randomUUID();
      await action.mutateAsync(
        target.importContext
          ? {
              entity: "import",
              operation: "update",
              id: target.importContext.id,
              revision: target.importContext.revision,
              fields: {
                index: target.importContext.index,
                entry: fields,
                occurrence_id: values.occurrence_id || null,
              },
              request_id: request.current,
            }
          : {
              entity,
              operation: target.operation ?? (target.id ? "update" : "create"),
              id: target.id,
              revision: target.revision,
              fields,
              request_id: request.current,
            },
      );
      toast.success(resolving ? "Expense saved" : "Saved");
      onClose();
    } catch (error) {
      if (!action.isError) toast.error((error as Error).message);
    }
  }
  return (
    <>
      <Modal
        open
        onOpenChange={(open) => {
          if (!open) close();
        }}
        title={title}
        description={
          resolving
            ? "Record the actual payment or link an existing expense."
            : ""
        }
        className="finance-editor"
      >
        <form className="finance-form" onSubmit={(event) => void submit(event)}>
          {resolving && (
            <>
              <strong className="finance-resolve-name">
                {String(original.name ?? "")}
              </strong>
              {select("Expense record", "entry_id", [
                { value: "", label: "Record a new expense" },
                ...board.entries
                  .filter((item) => item.kind === "expense")
                  .map((item) => ({
                    value: item.id,
                    label: `${item.name} (${item.day})`,
                  })),
              ])}
            </>
          )}
          {!resolving && entity !== "reservation" && field("Name", "name")}
          {entity === "entry" &&
            select(
              "Type",
              "kind",
              ["expense", "income", "transfer"].map((value) => ({
                value,
                label: value[0].toUpperCase() + value.slice(1),
              })),
            )}
          {target.importContext &&
            select("Recurring payment match", "occurrence_id", [
              { value: "", label: "Not a recurring payment" },
              ...target.importContext.occurrenceIds.map((id) => {
                const item = board.items.find((item) => item.id === id);
                return {
                  value: id,
                  label: `${String(item?.fields.name ?? id)} · ${String(item?.fields.due_on ?? "")}`,
                };
              }),
            ])}
          {entity === "purchase" && !resolving
            ? field("Price", "price", "number")
            : !values.entry_id && field("Amount", "amount", "number")}
          {entity !== "purchase" || resolving
            ? !values.entry_id &&
              accounts.length > 1 &&
              select("Account", "account_id", accounts)
            : null}
          {entity === "entry" &&
            values.kind === "transfer" &&
            select(
              "To account",
              "target_account_id",
              accounts.filter((item) => item.value !== values.account_id),
            )}
          {(entity === "entry" || entity === "payment") &&
            !resolving &&
            select(
              "Category",
              "category",
              board.settings.categories.map((value) => ({
                value,
                label: value,
              })),
            )}
          {entity === "purchase" && !resolving ? (
            <>
              {select(
                "Priority",
                "priority",
                ["Low", "Medium", "High"].map((value) => ({
                  value,
                  label: value,
                })),
              )}
              {dateField("Target date", "target_date", true)}
              {field("Product link", "link", "url", false)}
            </>
          ) : (
            !values.entry_id &&
            dateField(
              entity === "payment" ? "First due date" : "Date",
              entity === "payment" ? "starts_on" : "day",
            )
          )}
          {entity === "entry" &&
            values.kind === "income" &&
            dateField("Planned payday (optional)", "payday_date", true)}
          {entity === "payment" && (
            <>
              {select("Repeat", "unit", [
                { value: "day", label: "Days" },
                { value: "week", label: "Weeks" },
                { value: "month", label: "Months" },
                { value: "year", label: "Years" },
              ])}
              {field("Every", "interval", "number")}
              {select("Payment reminder", "reminder_days", [
                { value: "", label: "Use Finance settings" },
                { value: "-1", label: "Off" },
                { value: "0", label: "On due date" },
                { value: "1", label: "1 day before" },
                { value: "3", label: "3 days before" },
                { value: "7", label: "1 week before" },
              ])}
              {select("Recording", "confirm", [
                { value: "yes", label: "Ask for confirmation" },
                { value: "no", label: "Record automatically" },
              ])}
            </>
          )}
          {(entity === "purchase" || entity === "entry") && !resolving && (
            <>
              <label className="finance-wide">
                Notes
                <textarea
                  value={values.notes}
                  maxLength={8000}
                  onChange={(event) => update("notes", event.target.value)}
                />
              </label>
              <div className="finance-photos finance-wide">
                {photos.map((id) => (
                  <div key={id}>
                    <img src={photoUrl(id)} alt="Attached Finance image" />
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="Remove image"
                      onClick={() => {
                        setPhotos((current) =>
                          current.filter((item) => item !== id),
                        );
                        setDirty(true);
                        request.current = null;
                      }}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
                {photos.length < 8 && (
                  <label className="finance-photo-add">
                    <ImagePlus size={18} />
                    <span>{uploading ? "Uploading…" : "Add image"}</span>
                    <input
                      type="file"
                      accept="image/*"
                      hidden
                      disabled={pending}
                      onChange={async (event) => {
                        const file = event.target.files?.[0];
                        if (!file) return;
                        setUploading(true);
                        try {
                          const photo = await financeApi.photo(file);
                          setPhotos((current) => [...current, photo.id]);
                          setDirty(true);
                          request.current = null;
                        } catch (error) {
                          toast.error((error as Error).message);
                        } finally {
                          setUploading(false);
                        }
                      }}
                    />
                  </label>
                )}
              </div>
            </>
          )}
          {action.error && <Notice>{action.error.message}</Notice>}
          <div className="finance-form-actions finance-wide">
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={close}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : resolving ? "Record expense" : "Save"}
            </Button>
          </div>
        </form>
      </Modal>
      <ConfirmDialog
        open={discard}
        onClose={() => setDiscard(false)}
        keepLabel="Keep editing"
        title="Discard changes?"
        description="Your changes have not been saved."
        confirmLabel="Discard"
        onConfirm={onClose}
      />
    </>
  );
}
