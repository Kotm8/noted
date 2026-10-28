import {
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import {
  Bold,
  Braces,
  Check,
  ChevronDown,
  Code,
  Italic,
  Link,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  Pilcrow,
  Quote,
  Strikethrough,
} from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Button } from "../../components/ui/button";
import { Modal } from "../../components/ui/dialog";
import { applyEdit } from "../../lib/list-editing";
import {
  codeBlock,
  insertDivider,
  insertLink,
  lineFormat,
  setLineFormat,
  toggleInline,
  type Formatted,
  type InlineFormat,
  type LineFormat,
} from "../../lib/markdown-format";
import { readStoredValue, writeStoredValue } from "../../lib/storage";
import { isMobileLayout } from "../../lib/layout";

const VISIBLE_KEY = "noted.formatting.visible";

const listeners = new Set<() => void>();
let visibleNow: boolean | null = null;

function readVisible() {
  if (visibleNow === null) {
    const stored = readStoredValue(VISIBLE_KEY);
    visibleNow =
      stored === null
        ? !(typeof window.matchMedia === "function" && isMobileLayout())
        : stored === "true";
  }
  return visibleNow;
}

/**
 * Whether the formatting row is shown, remembered per device and shared by
 * every text box. Phones start with it hidden.
 */
export function useFormattingVisible() {
  const visible = useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, readVisible);
  return [
    visible,
    () => {
      visibleNow = !visible;
      writeStoredValue(VISIBLE_KEY, String(visibleNow));
      listeners.forEach((listener) => listener());
    },
  ] as const;
}

const STYLES: Array<[LineFormat, string]> = [
  ["normal", "Normal text"],
  ["h1", "Heading 1"],
  ["h2", "Heading 2"],
  ["h3", "Heading 3"],
];

const shortcut = navigator.platform.startsWith("Mac") ? "⌘" : "Ctrl+";

/**
 * Formatting for a Markdown text box: the toolbar row, Slack's keyboard
 * shortcuts, and the link dialog. Everything edits the text the way typing
 * would, so undo works and the stored format stays plain Markdown.
 */
export function useFormatting(inputRef: RefObject<HTMLTextAreaElement | null>) {
  const [link, setLink] = useState<{
    start: number;
    end: number;
    text: string;
    url: string;
  } | null>(null);

  function run(
    format: (value: string, start: number, end: number) => Formatted,
  ) {
    const input = inputRef.current;
    if (!input) return;
    const { edit, selection } = format(
      input.value,
      input.selectionStart,
      input.selectionEnd,
    );
    applyEdit(input, edit);
    input.setSelectionRange(...selection);
  }

  const inline = (format: InlineFormat) =>
    run((value, start, end) => toggleInline(value, start, end, format));
  const line = (format: LineFormat) =>
    run((value, start, end) => setLineFormat(value, start, end, format));

  function openLink() {
    const input = inputRef.current;
    if (!input) return;
    const { selectionStart: start, selectionEnd: end, value } = input;
    const selected = value.slice(start, end);
    const isUrl = /^https?:\/\/\S+$/.test(selected.trim());
    setLink({
      start,
      end,
      text: isUrl ? "" : selected,
      url: isUrl ? selected.trim() : "",
    });
  }

  function saveLink() {
    if (!link) return;
    const url = /^[a-z][a-z0-9+.-]*:/i.test(link.url.trim())
      ? link.url.trim()
      : `https://${link.url.trim()}`;
    const { start, end, text } = link;
    setLink(null);
    requestAnimationFrame(() =>
      run((value) => insertLink(value, start, end, text, url)),
    );
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return false;
    const action = event.shiftKey
      ? {
          KeyX: () => inline("strike"),
          KeyC: () => inline("code"),
          Digit7: () => line("numbered"),
          Digit8: () => line("bullet"),
          Digit9: () => line("quote"),
        }[event.code]
      : {
          KeyB: () => inline("bold"),
          KeyI: () => inline("italic"),
          KeyK: openLink,
        }[event.code];
    if (!action) return false;
    event.preventDefault();
    action();
    return true;
  }

  const current = () => {
    const input = inputRef.current;
    if (!input) return "normal";
    const from = input.value.lastIndexOf("\n", input.selectionStart - 1) + 1;
    return lineFormat(input.value.slice(from).split("\n")[0]);
  };

  const tool = (
    label: string,
    icon: ReactNode,
    action: () => void,
    keys?: string,
  ) => (
    <button
      key={label}
      type="button"
      className="icon-button"
      aria-label={label}
      title={keys ? `${label} (${keys})` : label}
      // Keeps the text selection while clicking.
      onMouseDown={(event) => event.preventDefault()}
      onClick={action}
    >
      {icon}
    </button>
  );

  const toolbar = (
    <div className="format-toolbar" role="toolbar" aria-label="Formatting">
      {tool("Bold", <Bold size={15} />, () => inline("bold"), `${shortcut}B`)}
      {tool(
        "Italic",
        <Italic size={15} />,
        () => inline("italic"),
        `${shortcut}I`,
      )}
      {tool(
        "Strikethrough",
        <Strikethrough size={15} />,
        () => inline("strike"),
        `${shortcut}Shift+X`,
      )}
      <span className="format-divider" />
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            className="icon-button format-style"
            aria-label="Text style"
            title="Text style"
            onMouseDown={(event) => event.preventDefault()}
          >
            <Pilcrow size={15} />
            <ChevronDown size={11} />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            className="dropdown-content"
            align="start"
            sideOffset={6}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              inputRef.current?.focus();
            }}
          >
            {STYLES.map(([format, label]) => (
              <DropdownMenu.Item
                key={format}
                className={`dropdown-item format-style-${format}`}
                onSelect={() => requestAnimationFrame(() => line(format))}
              >
                {label}
                {current() === format && <Check size={14} />}
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <span className="format-divider" />
      {tool("Link", <Link size={15} />, openLink, `${shortcut}K`)}
      <span className="format-divider" />
      {tool(
        "Numbered list",
        <ListOrdered size={15} />,
        () => line("numbered"),
        `${shortcut}Shift+7`,
      )}
      {tool(
        "Bulleted list",
        <List size={15} />,
        () => line("bullet"),
        `${shortcut}Shift+8`,
      )}
      {tool("Checklist", <ListTodo size={15} />, () => line("task"))}
      <span className="format-divider" />
      {tool(
        "Quote",
        <Quote size={15} />,
        () => line("quote"),
        `${shortcut}Shift+9`,
      )}
      {tool(
        "Code",
        <Code size={15} />,
        () => inline("code"),
        `${shortcut}Shift+C`,
      )}
      {tool("Code block", <Braces size={15} />, () => run(codeBlock))}
      <span className="format-divider" />
      {tool("Divider", <Minus size={15} />, () => run(insertDivider))}
    </div>
  );

  const dialog = link && (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) {
          setLink(null);
          inputRef.current?.focus();
        }
      }}
      title="Add link"
      description="The text shows in your message and opens the address."
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        document
          .querySelector<HTMLInputElement>(
            link.text ? "#format-link-url" : "#format-link-text",
          )
          ?.focus();
      }}
    >
      <form
        className="format-link-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (link.url.trim()) saveLink();
        }}
      >
        <label>
          Text
          <input
            id="format-link-text"
            value={link.text}
            onChange={(event) => setLink({ ...link, text: event.target.value })}
          />
        </label>
        <label>
          Link
          <input
            id="format-link-url"
            value={link.url}
            placeholder="https://"
            inputMode="url"
            onChange={(event) => setLink({ ...link, url: event.target.value })}
          />
        </label>
        <div className="dialog-actions">
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setLink(null);
              inputRef.current?.focus();
            }}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={!link.url.trim()}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );

  return { toolbar, dialog, onKeyDown };
}
