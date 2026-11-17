import { useRef, useState } from "react";
import { ImagePlus, LoaderCircle, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "../../components/ui/button";
import { Select } from "../../components/ui/select";
import { DatePicker } from "../../components/ui/date-picker";
import { Notice } from "../../components/ui/notice";
import { request } from "../../lib/http";
import { financeApi, photoUrl, useFinanceAction } from "./api";
import { itemsOf, type FinanceBoard, type Item } from "./types";
import type { EditorTarget } from "./editor";

interface ImportFields {
  status: string;
  entries: { id: string; revision: number }[];
  photo_ids: string[];
  pending: {
    index: number;
    fields: Record<string, unknown>;
    reason: string;
    status: string;
    occurrence_ids: string[];
  }[];
  skipped: number;
  note: string;
}

export function ImportDock({
  board,
  onEdit,
}: {
  board: FinanceBoard;
  onEdit: (target: EditorTarget) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [account, setAccount] = useState(
    board.settings.default_account_id ?? "",
  );
  const [day, setDay] = useState(board.today);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [resultId, setResultId] = useState<string | null>(null);
  const [history, setHistory] = useState(false);
  const photo = useRef<{ id: string; file: File } | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const attempt = useRef<string | null>(null);
  const client = useQueryClient();
  const action = useFinanceAction();
  const imports = itemsOf<ImportFields>(board, "import");
  const result = imports.find((item) => item.id === resultId);
  async function upload() {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      if (photo.current?.file !== file)
        photo.current = { ...(await financeApi.photo(file)), file };
      attempt.current ??= crypto.randomUUID();
      const result = await request<{
        id: string;
        entries: unknown[];
        pending: unknown[];
      }>("/finance/imports", "POST", {
        request_id: attempt.current,
        photo_id: photo.current.id,
        account_id: account,
        day,
      });
      setResultId(result.id);
      await client.invalidateQueries({ queryKey: ["finance"] });
      setFile(null);
      attempt.current = null;
      toast.success(
        `${result.entries.length} transactions recorded${result.pending.length ? `, ${result.pending.length} need review` : ""}`,
      );
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function review(batch: Item<ImportFields>) {
    return (
      <section className="finance-import-result" key={batch.id}>
        <div className="finance-section-heading">
          <h3>
            {batch.fields.status === "undone"
              ? "Import undone"
              : `${batch.fields.entries.length} transactions recorded`}
          </h3>
          <div>
            {batch.fields.status !== "undone" && (
              <Button
                size="small"
                variant="ghost"
                disabled={action.isPending}
                onClick={() =>
                  action.mutate({
                    entity: "import",
                    operation: "undo",
                    id: batch.id,
                    revision: batch.revision,
                  })
                }
              >
                Undo import
              </Button>
            )}
            <button
              className="icon-button"
              aria-label="Close import result"
              onClick={() => {
                setResultId(null);
                setHistory(false);
              }}
            >
              <X size={15} />
            </button>
          </div>
        </div>
        {batch.fields.note && <p>{batch.fields.note}</p>}
        {batch.fields.skipped > 0 && (
          <p>
            {batch.fields.skipped} pending, cancelled or failed payments
            skipped.
          </p>
        )}
        {batch.fields.status !== "undone" &&
          batch.fields.pending
            .filter((item) => item.status === "pending")
            .map((item) => (
              <div className="finance-import-pending" key={item.index}>
                <div>
                  <strong>
                    {String(item.fields.name || "Unclear transaction")}
                  </strong>
                  <span>{item.reason}</span>
                </div>
                <Button
                  size="small"
                  variant="secondary"
                  onClick={() =>
                    onEdit({
                      entity: "entry",
                      fields: item.fields,
                      importContext: {
                        id: batch.id,
                        revision: batch.revision,
                        index: item.index,
                        occurrenceIds: item.occurrence_ids,
                      },
                    })
                  }
                >
                  Review
                </Button>
                <Button
                  size="small"
                  variant="ghost"
                  disabled={action.isPending}
                  onClick={() =>
                    action.mutate({
                      entity: "import",
                      operation: "update",
                      id: batch.id,
                      revision: batch.revision,
                      fields: { index: item.index, skip: true },
                    })
                  }
                >
                  Skip
                </Button>
              </div>
            ))}
        {batch.fields.photo_ids[0] && (
          <a
            href={photoUrl(batch.fields.photo_ids[0])}
            target="_blank"
            rel="noreferrer"
          >
            View source image
          </a>
        )}
      </section>
    );
  }
  return (
    <div className="finance-import-area">
      {result && review(result)}
      {history &&
        imports
          .slice()
          .reverse()
          .slice(0, 10)
          .map((item) => review(item))}
      {file ? (
        <div className="finance-import-confirm">
          <div className="finance-section-heading">
            <h3>{busy ? "Reading your spending…" : file.name}</h3>
            <button
              className="icon-button"
              disabled={busy}
              aria-label="Cancel image import"
              onClick={() => {
                setFile(null);
                setError("");
              }}
            >
              <X size={16} />
            </button>
          </div>
          <p>
            Clear new entries will be recorded. Unclear amounts and possible
            duplicates will wait for review.
          </p>
          <div className="finance-import-options">
            {board.accounts.filter((item) => !item.archived).length > 1 && (
              <Select
                label="Import account"
                value={account}
                options={board.accounts
                  .filter((item) => !item.archived)
                  .map((item) => ({ value: item.id, label: item.name }))}
                onChange={(value) => {
                  setAccount(value);
                  attempt.current = null;
                }}
              />
            )}
            <DatePicker
              label="Spending date"
              value={day}
              onChange={(value) => {
                setDay(value);
                attempt.current = null;
              }}
            />
            <Button disabled={busy} onClick={() => void upload()}>
              {busy ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <Upload size={16} />
              )}
              Import spending
            </Button>
          </div>
          {error && <Notice>{error}</Notice>}
        </div>
      ) : (
        <div
          className="finance-import-dock"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const file = event.dataTransfer.files[0];
            if (file?.type.startsWith("image/")) {
              setFile(file);
              setHistory(false);
            }
          }}
        >
          <button
            disabled={busy}
            onClick={() => {
              picker.current?.click();
              setHistory(false);
            }}
          >
            <ImagePlus size={18} />
            <span>Describe spending with a screenshot, or choose an image</span>
            <Upload size={16} />
          </button>
          {imports.length > 0 && (
            <button
              onClick={() => {
                setHistory(!history);
                setResultId(null);
              }}
            >
              Imports
            </button>
          )}
        </div>
      )}
      <input
        ref={picker}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            setFile(file);
            attempt.current = null;
          }
          event.target.value = "";
        }}
      />
    </div>
  );
}
