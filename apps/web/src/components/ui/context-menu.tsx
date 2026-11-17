import * as Context from "@radix-ui/react-context-menu";
import { useSyncExternalStore, type ReactElement, type ReactNode } from "react";
import { MenuKind } from "./menu-kind";

const media = "(hover: hover) and (pointer: fine)";
function subscribe(change: () => void) {
  const query = window.matchMedia?.(media);
  query?.addEventListener("change", change);
  return () => query?.removeEventListener("change", change);
}
function desktop() {
  return window.matchMedia?.(media).matches ?? false;
}

function nativeEditing(target: EventTarget) {
  if (!(target instanceof Element)) return false;
  const editor = target.closest(
    'input, textarea, select, [contenteditable="true"], video, audio',
  );
  return editor instanceof HTMLInputElement
    ? ["text", "search", "email", "url", "tel", "number", "password"].includes(
        editor.type,
      )
    : Boolean(editor);
}

export function ContextMenu({
  children,
  menu,
  disabled = false,
  label = "Item actions",
}: {
  children: ReactElement;
  menu: ReactNode;
  disabled?: boolean;
  label?: string;
}) {
  const enabled = useSyncExternalStore(subscribe, desktop, () => false);
  return (
    <MenuKind.Provider value="context">
      <Context.Root>
        <Context.Trigger
          asChild
          disabled={disabled || !enabled}
          style={{
            WebkitTouchCallout: enabled && !disabled ? "none" : "default",
          }}
          onContextMenuCapture={(event) => {
            if (nativeEditing(event.target)) event.stopPropagation();
          }}
          onContextMenu={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (
              !enabled ||
              disabled ||
              !(
                event.key === "ContextMenu" ||
                (event.shiftKey && event.key === "F10")
              )
            )
              return;
            if (nativeEditing(event.target)) return;
            event.preventDefault();
            event.stopPropagation();
            const bounds = event.currentTarget.getBoundingClientRect();
            event.currentTarget.dispatchEvent(
              new MouseEvent("contextmenu", {
                bubbles: true,
                cancelable: true,
                clientX: bounds.left + Math.min(20, bounds.width),
                clientY: bounds.top + Math.min(20, bounds.height),
              }),
            );
          }}
        >
          {children}
        </Context.Trigger>
        <Context.Portal>
          <Context.Content
            className="dropdown-content"
            collisionPadding={10}
            aria-label={label}
            style={{
              maxHeight: "var(--radix-context-menu-content-available-height)",
              overflowY: "auto",
            }}
          >
            {menu}
          </Context.Content>
        </Context.Portal>
      </Context.Root>
    </MenuKind.Provider>
  );
}
