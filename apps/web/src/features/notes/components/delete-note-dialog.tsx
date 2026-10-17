import { Button } from "../../../components/ui/button";
import { Modal } from "../../../components/ui/dialog";

interface DeleteNoteDialogProps {
  open: boolean;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function DeleteNoteDialog({ open, pending, onClose, onConfirm }: DeleteNoteDialogProps) {
  return (
    <Modal
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen && !pending) onClose();
      }}
      title="Delete this note?"
      description="This note will be permanently removed from this channel."
    >
      <div className="dialog-actions">
        <Button variant="ghost" onClick={onClose} disabled={pending}>
          Keep note
        </Button>
        <Button variant="danger" onClick={onConfirm} disabled={pending}>
          Delete note
        </Button>
      </div>
    </Modal>
  );
}
