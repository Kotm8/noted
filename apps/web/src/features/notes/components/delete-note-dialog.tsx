import { ConfirmDialog } from "../../../components/ui/confirm-dialog";

interface DeleteNoteDialogProps {
  open: boolean;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function DeleteNoteDialog(props: DeleteNoteDialogProps) {
  return (
    <ConfirmDialog
      {...props}
      title="Delete this note?"
      description="This note will be permanently removed from this channel."
      keepLabel="Keep note"
      confirmLabel="Delete note"
    />
  );
}
