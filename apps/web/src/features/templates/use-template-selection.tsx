import { useState } from "react";
import { ConfirmDialog } from "../../components/ui/confirm-dialog";

export function useTemplateSelection() {
  const [id, setId] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [next, setNext] = useState<string | null>(null);
  function activate(value: string | null) {
    setId(value);
    setVersion((current) => current + 1);
  }
  function select(value: string) {
    if (dirty) setNext(value);
    else activate(value);
  }
  return {
    id,
    version,
    setId: activate,
    setDirty,
    select,
    confirmation: (
      <ConfirmDialog
        open={next !== null}
        title="Discard unsaved template changes?"
        description="Your saved template will stay as it was."
        keepLabel="Keep editing"
        confirmLabel="Discard changes"
        onClose={() => setNext(null)}
        onConfirm={() => {
          setDirty(false);
          activate(next);
          setNext(null);
        }}
      />
    ),
  };
}
