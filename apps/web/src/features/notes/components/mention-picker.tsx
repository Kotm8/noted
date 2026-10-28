import {
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { caretPosition } from "../../../lib/caret";
import { applyEdit } from "../../../lib/list-editing";
import { ChannelIcon } from "../../workspaces/components/channel-icon";
import type { Channel } from "../../workspaces/types";
import { useMentionDirectory } from "../mention-context";
import { mentionQuery, type MentionRefs } from "../mentions";

const MENU_WIDTH = 340;

/**
 * Slack-style "#" channel picker for a text box. Tab or Enter inserts the
 * highlighted channel. Short chat boxes show it above the box; long writing
 * areas pass `atCaret` so it opens under the line being typed.
 */
export function useMentionPicker(
  inputRef: RefObject<HTMLTextAreaElement | null>,
  value: string,
  initialRefs?: MentionRefs,
  atCaret = false,
) {
  const { channels, workspaces } = useMentionDirectory();
  const refs = useRef<MentionRefs>(new Map(initialRefs));
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);

  useLayoutEffect(() => {
    setCaret(inputRef.current?.selectionStart ?? value.length);
  }, [inputRef, value]);

  const match = mentionQuery(value, caret);
  const query = match?.query.toLowerCase() ?? "";
  const suggestions =
    match && match.start !== dismissedAt
      ? channels
          .filter((channel) => channel.name.toLowerCase().includes(query))
          .sort(
            (a, b) =>
              Number(!a.name.toLowerCase().startsWith(query)) -
              Number(!b.name.toLowerCase().startsWith(query)),
          )
          .slice(0, 8)
      : [];
  const highlighted = Math.min(active, Math.max(0, suggestions.length - 1));

  function choose(channel: Channel) {
    const input = inputRef.current;
    if (!input || !match) return;
    refs.current.set(channel.name, channel.id);
    applyEdit(input, {
      start: match.start,
      end: caret,
      text: `#${channel.name} `,
    });
    setActive(0);
  }

  /** Returns true when the picker handled the key. */
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
    if (!suggestions.length || event.nativeEvent.isComposing) return false;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((highlighted + step + suggestions.length) % suggestions.length);
    } else if (event.key === "Tab" || event.key === "Enter") {
      choose(suggestions[highlighted]);
    } else if (event.key === "Escape") {
      setDismissedAt(match!.start);
    } else return false;
    event.preventDefault();
    return true;
  }

  const input = inputRef.current;
  const position =
    atCaret && input && match ? caretPosition(input, match.start) : null;
  const menu = suggestions.length > 0 && (
    <ul
      className="mention-menu"
      role="listbox"
      aria-label="Channels"
      style={
        position
          ? {
              top: position.top,
              left: Math.max(
                0,
                Math.min(position.left, input!.clientWidth - MENU_WIDTH),
              ),
              bottom: "auto",
            }
          : undefined
      }
    >
      {suggestions.map((channel, index) => (
        <li
          key={channel.id}
          role="option"
          aria-selected={index === highlighted}
          onMouseDown={(event) => {
            event.preventDefault();
            choose(channel);
          }}
          onMouseEnter={() => setActive(index)}
        >
          <ChannelIcon kind={channel.kind} size={14} />
          <span>{channel.name}</span>
          <small>
            {workspaces.find((item) => item.id === channel.workspace_id)?.name}
          </small>
        </li>
      ))}
    </ul>
  );

  return {
    refs,
    menu,
    onKeyDown,
    onSelect: () => setCaret(inputRef.current?.selectionStart ?? value.length),
  };
}
