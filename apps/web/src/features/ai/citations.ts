const NOTED_PATH = /\/w\/[0-9a-f-]{36}\/c\/[0-9a-f-]{36}(?:\?[^\s)\]]*)?/g;

/**
 * Models sometimes leave citation markup in their text: private-use markers like
 * "citeturn0search1", bracketed ones like "【4†source】", or a bare Noted
 * path. Markers go (the sources list shows them), and bare paths become readable links.
 */
export function cleanCitations(text: string): string {
  const cleaned = text
    .replace(/[^]*/g, "")
    .replace(/【[^】]*】/g, "")
    .replace(/\[\^?\d+\](?!\()/g, "");
  let result = "";
  let last = 0;
  for (const match of cleaned.matchAll(NOTED_PATH)) {
    const start = match.index;
    const before = cleaned.slice(Math.max(0, start - 2), start);
    // Already a Markdown link target, like [title](/w/…): leave it alone.
    if (before.endsWith("(") || before.endsWith("<")) continue;
    result += cleaned.slice(last, start) + `[note](${match[0]})`;
    last = start + match[0].length;
  }
  return (result + cleaned.slice(last)).replace(/[ \t]+([.,;:])/g, "$1");
}
