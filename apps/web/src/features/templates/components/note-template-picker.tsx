import { useRef, useState, type RefObject } from "react";
import * as Popover from "@radix-ui/react-popover";
import { ChevronDown, Layers, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../../../components/ui/button";
import { Notice } from "../../../components/ui/notice";
import { applyEdit } from "../../../lib/list-editing";
import { useAndroidBackLayer } from "../../../lib/android-navigation";
import { Markdown } from "../../notes/components/markdown";
import { useNoteTemplates } from "../api";
import { TemplateList } from "./template-list";

export function NoteTemplatePicker({
  inputRef,
}: {
  inputRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const [open, setOpen] = useState(false);
  const [id, setId] = useState<string | null>(null);
  const range = useRef<[number, number]>([0, 0]);
  const closing = useRef<"close" | "insert" | "manage">("close");
  const query = useNoteTemplates(open);
  const items = query.data ?? [];
  const selected = items.find((item) => item.id === id) ?? items[0];
  useAndroidBackLayer(open, () => setOpen(false));
  function insert() {
    const input = inputRef.current;
    if (!input || !selected) return;
    const [start, end] = range.current;
    if (
      input.maxLength > -1 &&
      input.value.length - (end - start) + selected.content.length >
        input.maxLength
    ) {
      toast.error("This template would exceed the note's text limit.");
      return;
    }
    closing.current = "insert";
    setOpen(false);
    requestAnimationFrame(() =>
      applyEdit(input, { start, end, text: selected.content }),
    );
  }
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (next) closing.current = "close";
        if (next && inputRef.current)
          range.current = [
            inputRef.current.selectionStart,
            inputRef.current.selectionEnd,
          ];
        setOpen(next);
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          className="template-toolbar-trigger"
          aria-label="Note templates"
          onMouseDown={(event) => event.preventDefault()}
        >
          <Layers size={15} />
          <span>Templates</span>
          <ChevronDown size={11} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="note-template-picker"
          side="top"
          align="start"
          sideOffset={10}
          collisionPadding={12}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (closing.current === "close") {
              inputRef.current?.focus({ preventScroll: true });
              inputRef.current?.setSelectionRange(...range.current);
            }
          }}
          aria-label="Choose a note template"
        >
          <header>
            <strong>
              <Layers size={15} />
              Note templates
            </strong>
            <Popover.Close className="icon-button" aria-label="Close templates">
              <X size={16} />
            </Popover.Close>
          </header>
          {query.error && (
            <Notice tone="error">
              {query.error.message}
              <button type="button" onClick={() => void query.refetch()}>
                Retry
              </button>
            </Notice>
          )}
          {query.isPending ? (
            <p className="template-empty">Loading templates…</p>
          ) : (
            <div className="template-picker-body">
              <TemplateList
                kind="note"
                search
                items={items.map((item) => ({
                  ...item,
                  detail: `${item.content.split("\n").length} lines`,
                }))}
                selected={selected?.id ?? ""}
                onSelect={setId}
              />
              <div className="template-picker-preview">
                {selected ? (
                  <>
                    <small>{selected.name}</small>
                    <Markdown content={selected.content} />
                  </>
                ) : (
                  <p className="template-empty">
                    Create your first template in Settings.
                  </p>
                )}
              </div>
            </div>
          )}
          <footer>
            <button
              type="button"
              className="template-manage-link"
              onClick={() => {
                closing.current = "manage";
                setOpen(false);
                window.dispatchEvent(
                  new CustomEvent("noted:template-settings", {
                    detail: "notes",
                  }),
                );
              }}
            >
              Manage templates
            </button>
            <Button size="small" disabled={!selected} onClick={insert}>
              Insert template
            </Button>
          </footer>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
