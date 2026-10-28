import type { Channel } from "../workspaces/types";

/** Stored form of a channel mention, like Slack: <#channel-id|name>. */
const TOKEN = /<#([0-9a-f-]{36})\|([^>\n]*)>/g;

/**
 * Text boxes show plain "#name"; this maps each shown name to the channel the
 * person picked, so only chosen mentions (not ordinary # text) get stored.
 */
export type MentionRefs = Map<string, string>;

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function toEditable(
  content: string,
  channels: Channel[] = [],
): { text: string; refs: MentionRefs } {
  const refs: MentionRefs = new Map();
  const text = content.replace(TOKEN, (_, id: string, stored: string) => {
    const name = channels.find((channel) => channel.id === id)?.name ?? stored;
    refs.set(name, id);
    return `#${name}`;
  });
  return { text, refs };
}

export function toStored(text: string, refs: MentionRefs): string {
  const names = [...refs.keys()].sort((a, b) => b.length - a.length);
  if (!names.length) return text;
  const pattern = new RegExp(
    `(?<![\\w/#])#(${names.map(escape).join("|")})(?![\\w-])`,
    "g",
  );
  return text.replace(
    pattern,
    (_, name: string) => `<#${refs.get(name)}|${name.replace(/[|>]/g, "")}>`,
  );
}

export function readable(content: string): string {
  return content.replace(TOKEN, (_, _id, name: string) => `#${name}`);
}

export function mentionQuery(
  value: string,
  caret: number,
): { start: number; query: string } | null {
  const match = /(?:^|[\s(])#([^\s#<>|]{0,40})$/.exec(value.slice(0, caret));
  return match ? { start: caret - match[1].length - 1, query: match[1] } : null;
}

interface MarkdownNode {
  type: string;
  value?: string;
  url?: string;
  children?: MarkdownNode[];
  data?: { hProperties?: Record<string, unknown> };
}

/**
 * Renders mentions as links at parse time instead of rewriting the content,
 * because task checkboxes toggle by character offset into the original text.
 */
export function channelMentions(channels: Channel[] = []) {
  return (tree: MarkdownNode) => {
    function visit(node: MarkdownNode) {
      if (!node.children) return;
      node.children = node.children.flatMap((child) => {
        if (child.type !== "text" || !child.value?.includes("<#")) {
          visit(child);
          return [child];
        }
        const parts: MarkdownNode[] = [];
        let last = 0;
        for (const match of child.value.matchAll(TOKEN)) {
          const [token, id, stored] = match;
          const channel = channels.find((item) => item.id === id);
          parts.push({
            type: "text",
            value: child.value.slice(last, match.index),
          });
          parts.push({
            type: "link",
            url: channel ? `/w/${channel.workspace_id}/c/${id}` : "",
            data: { hProperties: { className: "channel-mention" } },
            children: [{ type: "text", value: `#${channel?.name ?? stored}` }],
          });
          last = match.index + token.length;
        }
        parts.push({ type: "text", value: child.value.slice(last) });
        return parts;
      });
    }
    visit(tree);
  };
}
