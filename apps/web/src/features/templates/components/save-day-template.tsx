import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../../../components/ui/button";
import { Modal } from "../../../components/ui/dialog";
import { Notice } from "../../../components/ui/notice";
import { dayLabel } from "../../schedule/dates";
import { templatesApi } from "../api";

export function SaveDayTemplate({
  date,
  timezone,
}: {
  date: string;
  timezone: string;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const client = useQueryClient();
  const save = useMutation({
    mutationFn: () => templatesApi.capture(name, date, timezone),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["templates", "days"] });
      setOpen(false);
      setName("");
      toast.success("Day saved as a template");
    },
  });
  return (
    <>
      <Button
        type="button"
        size="small"
        variant="secondary"
        onClick={() => {
          save.reset();
          setOpen(true);
        }}
      >
        <Copy size={14} />
        Save day
      </Button>
      <Modal
        open={open}
        onOpenChange={(value) => {
          if (!save.isPending) setOpen(value);
        }}
        title="Save day as a template"
        description={dayLabel(date, {
          weekday: "long",
          day: "numeric",
          month: "long",
        })}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!save.isPending) save.mutate();
          }}
        >
          <label>
            Template name
            <input
              autoFocus
              required
              maxLength={70}
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={save.isPending}
            />
          </label>
          <Notice>
            Only planned blocks are copied. Actual tracking stays on the
            calendar.
          </Notice>
          {save.error && <Notice tone="error">{save.error.message}</Notice>}
          <div className="dialog-actions">
            <Button
              type="button"
              variant="ghost"
              disabled={save.isPending}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending || !name.trim()}>
              {save.isPending ? "Saving…" : "Save template"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
