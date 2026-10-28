/**
 * Readable text for other apps: Markdown marks are removed, channel mentions
 * become #name, and links keep their address so nothing is lost.
 */
export function plainText(markdown: string): string {
  const parts = markdown.split(/(^```[^\n]*\n[\s\S]*?^```[ \t]*$)/m);
  return parts
    .map((part, index) =>
      index % 2 ? part.replace(/^```[^\n]*\n|\n?```[ \t]*$/g, "") : prose(part),
    )
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function prose(text: string): string {
  return text
    .replace(/<#[0-9a-f-]+\|([^>]+)>/gi, "#$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label: string, url: string) =>
      label === url ? url : `${label} (${url})`,
    )
    .replace(/^(\s*)[-*+] \[[xX]\] /gm, "$1☑ ")
    .replace(/^(\s*)[-*+] \[ \] /gm, "$1☐ ")
    .replace(/^(\s*)[-*+] /gm, "$1• ")
    .replace(/^#{1,6} +/gm, "")
    .replace(/^> ?/gm, "")
    .replace(/^ {0,3}([-*_])( *\1){2,} *$/gm, "———")
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "$2")
    .replace(/(^|[^\w*])[*_](?=\S)([^*_\n]*?\S)[*_](?![\w*])/g, "$1$2")
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/\\([\\`*_{}[\]()#+\-.!>~|])/g, "$1");
}
