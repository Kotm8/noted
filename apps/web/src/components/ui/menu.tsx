import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useState, type ReactNode } from "react";
import { useAndroidBackLayer } from "../../lib/android-navigation";

export function Menu({
  trigger,
  children,
  align = "end",
  onCloseAutoFocus,
}: {
  trigger: ReactNode;
  children: ReactNode;
  align?: "start" | "end";
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const [open, setOpen] = useState(false);
  useAndroidBackLayer(open, () => setOpen(false));
  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen}>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="dropdown-content"
          align={align}
          sideOffset={6}
          onCloseAutoFocus={onCloseAutoFocus}
        >
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function MenuItem({
  children,
  onSelect,
  danger = false,
  disabled = false,
}: {
  children: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <DropdownMenu.Item
      className={`dropdown-item ${danger ? "text-danger" : ""}`}
      onSelect={onSelect}
      disabled={disabled}
    >
      {children}
    </DropdownMenu.Item>
  );
}
