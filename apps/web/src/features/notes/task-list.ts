interface MarkdownNode {
  type: string;
  checked?: boolean | null;
  value?: string;
  children?: MarkdownNode[];
  position?: { start: { offset?: number } };
  data?: { hProperties?: Record<string, unknown> };
}

export function taskListPositions() {
  return (tree: MarkdownNode, file: { value: unknown }) => {
    const content = String(file.value);
    function visit(node: MarkdownNode) {
      const start = node.position?.start.offset;
      if (node.type === "listItem" && start !== undefined) {
        const newline = content.indexOf("\n", start);
        const line = content.slice(
          start,
          newline < 0 ? content.length : newline,
        );
        const marker = line.match(/^(?:[-+*]|\d+[.)])[ \t]+\[([ xX])\]/);
        const paragraph = node.children?.[0];
        const firstText = paragraph?.children?.[0];
        if (
          marker &&
          typeof node.checked !== "boolean" &&
          paragraph?.type === "paragraph" &&
          paragraph.children?.length === 1 &&
          firstText?.type === "text" &&
          /^\[[ xX]\]\s*$/.test(firstText.value ?? "")
        ) {
          node.checked = marker[1].toLowerCase() === "x";
          firstText.value = "";
        }
        if (marker && typeof node.checked === "boolean") {
          const offset = start + marker[0].length - 2;
          node.data = {
            ...node.data,
            hProperties: {
              ...node.data?.hProperties,
              "data-task-offset": offset,
              "data-task-label": line.slice(marker[0].length).trim(),
            },
          };
        }
      }
      node.children?.forEach(visit);
    }
    visit(tree);
  };
}
