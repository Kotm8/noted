import type { TextEdit } from "./list-editing";

export type InlineFormat = "bold" | "italic" | "strike" | "code";
export type LineFormat =
  "normal" | "h1" | "h2" | "h3" | "bullet" | "numbered" | "task" | "quote";

export interface Formatted {
  edit: TextEdit;
  selection: [number, number];
}

const MARKERS: Record<InlineFormat, string> = {
  bold: "**",
  italic: "_",
  strike: "~~",
  code: "`",
};

const PLACEHOLDERS: Record<InlineFormat, string> = {
  bold: "bold text",
  italic: "italic text",
  strike: "struck text",
  code: "code",
};

/** Wraps the selection in the marker, or unwraps it when it is already wrapped. */
export function toggleInline(
  value: string,
  start: number,
  end: number,
  format: InlineFormat,
): Formatted {
  const marker = MARKERS[format];
  const size = marker.length;
  const selected = value.slice(start, end);
  if (
    start >= size &&
    value.slice(start - size, start) === marker &&
    value.slice(end, end + size) === marker
  )
    return {
      edit: { start: start - size, end: end + size, text: selected },
      selection: [start - size, end - size],
    };
  if (
    selected.length > size * 2 &&
    selected.startsWith(marker) &&
    selected.endsWith(marker)
  ) {
    const inner = selected.slice(size, -size);
    return {
      edit: { start, end, text: inner },
      selection: [start, start + inner.length],
    };
  }
  const inner = selected || PLACEHOLDERS[format];
  return {
    edit: { start, end, text: `${marker}${inner}${marker}` },
    selection: [start + size, start + size + inner.length],
  };
}

const BLOCK_PREFIX =
  /^(\s*)(#{1,6} +|> ?|[-*+] +\[[ xX]\] +|[-*+] +|\d+[.)] +)?/;

export function lineFormat(line: string): LineFormat {
  const prefix = BLOCK_PREFIX.exec(line)?.[2]?.trim() ?? "";
  if (/^#$/.test(prefix)) return "h1";
  if (/^##$/.test(prefix)) return "h2";
  if (/^#{3,6}$/.test(prefix)) return "h3";
  if (prefix.startsWith(">")) return "quote";
  if (/\[[ xX]\]$/.test(prefix)) return "task";
  if (/^\d/.test(prefix)) return "numbered";
  return prefix ? "bullet" : "normal";
}

function prefixFor(format: LineFormat, index: number): string {
  return {
    normal: "",
    h1: "# ",
    h2: "## ",
    h3: "### ",
    bullet: "- ",
    numbered: `${index + 1}. `,
    task: "- [ ] ",
    quote: "> ",
  }[format];
}

function lineRange(value: string, start: number, end: number) {
  const last = end > start && value[end - 1] === "\n" ? end - 1 : end;
  const from = value.lastIndexOf("\n", start - 1) + 1;
  const next = value.indexOf("\n", last);
  return { from, to: next === -1 ? value.length : next };
}

/**
 * Turns every line touched by the selection into the given block type. When
 * all of them already are that type, they go back to plain text instead.
 */
export function setLineFormat(
  value: string,
  start: number,
  end: number,
  format: LineFormat,
): Formatted {
  const { from, to } = lineRange(value, start, end);
  const lines = value.slice(from, to).split("\n");
  const filled = lines.filter((line) => line.trim());
  const target =
    filled.length > 0 && filled.every((line) => lineFormat(line) === format)
      ? "normal"
      : format;
  let position = 0;
  const text = lines
    .map((line) => {
      if (!line.trim() && lines.length > 1) return line;
      const [prefix, indent] = BLOCK_PREFIX.exec(line)!;
      return `${indent}${prefixFor(target, position++)}${line.slice(prefix.length)}`;
    })
    .join("\n");
  const single = lines.length === 1 && start === end;
  const caret = from + text.length;
  return {
    edit: { start: from, end: to, text },
    selection: single ? [caret, caret] : [from, caret],
  };
}

export function codeBlock(
  value: string,
  start: number,
  end: number,
): Formatted {
  const selected = value.slice(start, end);
  const before = start === 0 || value[start - 1] === "\n" ? "" : "\n";
  const after = end === value.length || value[end] === "\n" ? "" : "\n";
  const opening = `${before}\`\`\`\n`;
  return {
    edit: { start, end, text: `${opening}${selected}\n\`\`\`${after}` },
    selection: [
      start + opening.length,
      start + opening.length + selected.length,
    ],
  };
}

export function insertLink(
  value: string,
  start: number,
  end: number,
  text: string,
  url: string,
): Formatted {
  const label = text.trim() || url;
  const link = `[${label.replaceAll("]", "\\]")}](${url.replaceAll(" ", "%20").replaceAll(")", "%29")})`;
  return {
    edit: { start, end, text: link },
    selection: [start + link.length, start + link.length],
  };
}

/** A divider right under a line of text would turn that line into a heading, so it gets a blank line first. */
export function insertDivider(
  value: string,
  start: number,
  end: number,
): Formatted {
  const before = value.slice(0, start);
  const lead = !before
    ? ""
    : before.endsWith("\n\n")
      ? ""
      : before.endsWith("\n")
        ? "\n"
        : "\n\n";
  const rest = value.slice(end);
  const text = `${lead}---\n${rest && !rest.startsWith("\n") ? "\n" : ""}`;
  const caret = start + text.length;
  return { edit: { start, end, text }, selection: [caret, caret] };
}
