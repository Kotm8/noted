import { parseNoteCommand } from "../../../reminders/commands";

export function documentReminderCommand(
  text: string,
  start: number,
  end: number,
) {
  if (start !== end) return null;
  const from = text.lastIndexOf("\n", start - 1) + 1;
  const next = text.indexOf("\n", start);
  const to = next < 0 ? text.length : next;
  if (start !== to) return null;
  let fence: { mark: string; length: number } | null = null;
  for (const line of text.slice(0, from).split("\n")) {
    const match = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (!match) continue;
    if (!fence) fence = { mark: match[1][0], length: match[1].length };
    else if (
      match[1][0] === fence.mark &&
      match[1].length >= fence.length &&
      !match[2].trim()
    )
      fence = null;
  }
  if (fence) return null;
  const line = text.slice(from, to);
  const indent = line.match(/^ {0,3}(?=\S)/)?.[0];
  if (indent === undefined) return null;
  const command = parseNoteCommand(line.slice(indent.length));
  return command
    ? { ...command, start: from + indent.length, end: to, source: text }
    : null;
}

export function reminderLink(name: string, id: string) {
  return `[${name.replace(/[\\[\]]/g, "\\$&")}](#reminder-${id})`;
}
