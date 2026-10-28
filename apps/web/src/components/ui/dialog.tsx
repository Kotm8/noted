import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { useAndroidBackLayer } from "../../lib/android-navigation";

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
  style,
  onOpenAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  onOpenAutoFocus?: (event: Event) => void;
}) {
  useAndroidBackLayer(open, () => onOpenChange(false));
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content
          className={`modal-content ${className ?? ""}`}
          style={style}
          onOpenAutoFocus={onOpenAutoFocus}
        >
          <Dialog.Title className="modal-title">{title}</Dialog.Title>
          <Dialog.Description className="modal-description">
            {description}
          </Dialog.Description>
          <Dialog.Close
            className="modal-close icon-button"
            aria-label="Close dialog"
          >
            <X size={18} />
          </Dialog.Close>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
