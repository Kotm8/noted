export interface SourceRange {
  start: number;
  end: number;
}

interface Wrapper extends SourceRange {
  innerStart: number;
  innerEnd: number;
}

export function markdownText(source: string) {
  const hidden = new Uint8Array(source.length);
  const wrappers: Wrapper[] = [];
  const hide = (start: number, end: number) => hidden.fill(1, start, end);
  for (const match of source.matchAll(
    /^ {0,3}(?:(?:#{1,6}|>)\s+|(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s*)?)+/gm,
  ))
    hide(match.index, match.index + match[0].length);
  for (const match of source.matchAll(/!?\[([^\]\n]*)\]\([^)]*\)/g)) {
    const start = match.index;
    const innerStart = start + (match[0][0] === "!" ? 2 : 1);
    const innerEnd = innerStart + match[1].length;
    hide(start, innerStart);
    hide(innerEnd, start + match[0].length);
    wrappers.push({
      start,
      end: start + match[0].length,
      innerStart,
      innerEnd,
    });
  }
  for (const pattern of [
    /(`+)([\s\S]*?)\1/g,
    /(\*\*|__|~~)(?=\S)([\s\S]*?\S)\1/g,
    /(?<![\w*])(\*|_)(?=\S)([^\n]*?\S)\1(?!\w)/g,
  ]) {
    for (const match of source.matchAll(pattern)) {
      const start = match.index;
      const width = match[1].length;
      const end = start + match[0].length;
      hide(start, start + width);
      hide(end - width, end);
      wrappers.push({
        start,
        end,
        innerStart: start + width,
        innerEnd: end - width,
      });
    }
  }
  for (const match of source.matchAll(/\\([\\`*{}[\]()#+.!_>~-])/g))
    hide(match.index, match.index + 1);
  const positions: number[] = [];
  let text = "";
  for (let index = 0; index < source.length; index++) {
    if (hidden[index]) continue;
    const character = /\s/.test(source[index]) ? " " : source[index];
    if (character === " " && (!text.length || text.endsWith(" "))) continue;
    text += character;
    positions.push(index);
  }
  return { text, positions, wrappers };
}

export function matchSelection(
  source: string,
  selected: string,
  near = 0,
): SourceRange | null {
  const normalized = selected.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  const plain = markdownText(source);
  let best = -1;
  let distance = Infinity;
  for (
    let index = plain.text.indexOf(normalized);
    index !== -1;
    index = plain.text.indexOf(normalized, index + 1)
  ) {
    const delta = Math.abs(index - near);
    if (delta < distance) {
      best = index;
      distance = delta;
    }
  }
  if (best === -1) return null;
  let start = plain.positions[best];
  let end = plain.positions[best + normalized.length - 1] + 1;
  for (let pass = 0; pass < plain.wrappers.length; pass++) {
    let changed = false;
    for (const wrapper of plain.wrappers) {
      if (
        start < wrapper.innerEnd &&
        end > wrapper.innerStart &&
        (start > wrapper.start || end < wrapper.end)
      ) {
        const nextStart = Math.min(start, wrapper.start),
          nextEnd = Math.max(end, wrapper.end);
        changed ||= nextStart !== start || nextEnd !== end;
        start = nextStart;
        end = nextEnd;
      }
    }
    if (!changed) break;
  }
  return { start, end };
}

export function paragraphEnd(source: string, cursor: number): number {
  const position = Math.max(0, Math.min(cursor, source.length));
  const boundary = /\n[ \t]*\n/g;
  boundary.lastIndex = position;
  return boundary.exec(source)?.index ?? source.length;
}

export function insertParagraph(
  source: string,
  at: number,
  text: string,
): string {
  const before = source.slice(0, at);
  const after = source.slice(at);
  const left = before && !/\n[ \t]*\n$/.test(before) ? "\n\n" : "";
  const right = after && !/^\n[ \t]*\n/.test(after) ? "\n\n" : "";
  return before + left + text.replace(/^\n+|\n+$/g, "") + right + after;
}
