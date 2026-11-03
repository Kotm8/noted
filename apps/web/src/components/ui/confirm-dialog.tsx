import { Button } from "./button";
import { Modal } from "./dialog";

export function ConfirmDialog({
  open,
  pending = false,
  title,
  description,
  keepLabel,
  confirmLabel,
  onClose,
  onConfirm,
}: {
  open: boolean;
  pending?: boolean;
  title: string;
  description: string;
  keepLabel: string;
  confirmLabel: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen && !pending) onClose();
      }}
      title={title}
      description={description}
    >
      <div className="dialog-actions">
        <Button variant="ghost" onClick={onClose} disabled={pending}>
          {keepLabel}
        </Button>
        <Button variant="danger" onClick={onConfirm} disabled={pending}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
