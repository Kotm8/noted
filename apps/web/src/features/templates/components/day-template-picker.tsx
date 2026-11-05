import { useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Layers, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../../../components/ui/button";
import { Modal } from "../../../components/ui/dialog";
import { Notice } from "../../../components/ui/notice";
import { isMobileLayout } from "../../../lib/layout";
import { dayLabel, duration } from "../../schedule/dates";
import { templatesApi, useDayTemplates } from "../api";
import { TemplateList } from "./template-list";

export function DayTemplatePicker({
  date,
  timezone,
}: {
  date: string;
  timezone: string;
}) {
  const [open, setOpen] = useState(false);
  const [id, setId] = useState<string | null>(null);
  const attempt = useRef({ key: "", requestId: "" });
  const query = useDayTemplates(open);
  const items = query.data ?? [];
  const selected = items.find((item) => item.id === id) ?? items[0];
  const client = useQueryClient();
  const apply = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("Choose a template first.");
      const key = `${selected.id}:${selected.revision}:${date}:${timezone}`;
      if (attempt.current.key !== key)
        attempt.current = { key, requestId: crypto.randomUUID() };
      return templatesApi.apply(
        selected,
        date,
        timezone,
        attempt.current.requestId,
      );
    },
    onSuccess: (result) => {
      void client.invalidateQueries({ queryKey: ["schedule"] });
      void client.invalidateQueries({ queryKey: ["home-activity"] });
      setOpen(false);
      attempt.current = { key: "", requestId: "" };
      toast.success(`${result.plans.length} plans added`);
    },
    onError: () => void query.refetch(),
  });
  const content = (
    <div className="day-template-picker-body">
      <header>
        <div>
          <strong>Use template</strong>
          <small>
            {dayLabel(date, {
              weekday: "short",
              day: "numeric",
              month: "long",
            })}
          </small>
        </div>
        {!isMobileLayout() && (
          <button
            type="button"
            className="icon-button"
            aria-label="Close templates"
            disabled={apply.isPending}
            onClick={() => setOpen(false)}
          >
            <X size={16} />
          </button>
        )}
      </header>
      {(query.error || apply.error) && (
        <Notice tone="error">{(apply.error ?? query.error)?.message}</Notice>
      )}
      {query.isPending ? (
        <p className="template-empty">Loading templates…</p>
      ) : (
        <TemplateList
          kind="day"
          items={items.map((item) => ({
            ...item,
            detail: `${item.blocks.length} blocks · ${duration(item.blocks.reduce((sum, block) => sum + block.end_minute - block.start_minute, 0) * 60)}`,
          }))}
          selected={selected?.id ?? ""}
          onSelect={(value) => {
            setId(value);
            apply.reset();
          }}
          disabled={apply.isPending}
        />
      )}
      <Notice>Adds one-off plans. Existing plans are kept.</Notice>
      <footer>
        <button
          type="button"
          className="template-manage-link"
          disabled={apply.isPending}
          onClick={() => {
            setOpen(false);
            window.dispatchEvent(
              new CustomEvent("noted:template-settings", { detail: "days" }),
            );
          }}
        >
          Manage templates
        </button>
        <Button
          size="small"
          disabled={!selected?.blocks.length || apply.isPending}
          onClick={() => apply.mutate()}
        >
          {apply.isPending ? "Adding…" : "Use template"}
        </Button>
      </footer>
    </div>
  );
  const trigger = (
    <button
      type="button"
      className="day-use-template"
      aria-label={`Use template on ${date}`}
      onClick={isMobileLayout() ? () => setOpen(true) : undefined}
    >
      <Layers size={12} />
      Use template
    </button>
  );
  if (isMobileLayout())
    return (
      <>
        {trigger}
        <Modal
          open={open}
          onOpenChange={(value) => {
            if (!apply.isPending) setOpen(value);
          }}
          className="plan-sheet"
          title="Use a day template"
          description="Adds plans without starting your tracker."
        >
          {content}
        </Modal>
      </>
    );
  return (
    <Popover.Root
      open={open}
      onOpenChange={(value) => {
        if (!apply.isPending) {
          if (value) apply.reset();
          setOpen(value);
        }
      }}
    >
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="plan-card day-template-picker"
          side="bottom"
          align="start"
          sideOffset={10}
          collisionPadding={12}
          aria-label="Use a day template"
        >
          {content}
          <Popover.Arrow className="plan-card-arrow" width={14} height={7} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
