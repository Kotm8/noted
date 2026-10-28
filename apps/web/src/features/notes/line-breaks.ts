interface MarkdownNode {
  type: string;
  value?: string;
  children?: MarkdownNode[];
}

/**
 * Markdown normally joins single newlines into one line. Notes are written
 * like chat messages, so every Shift+Enter should show as a new line.
 */
export function lineBreaks() {
  return (tree: MarkdownNode) => {
    function visit(node: MarkdownNode) {
      if (!node.children) return;
      node.children = node.children.flatMap((child) => {
        if (child.type !== "text" || !child.value?.includes("\n")) {
          visit(child);
          return [child];
        }
        return child.value
          .split("\n")
          .flatMap((value, index): MarkdownNode[] =>
            index
              ? [{ type: "break" }, { type: "text", value }]
              : [{ type: "text", value }],
          );
      });
    }
    visit(tree);
  };
}
