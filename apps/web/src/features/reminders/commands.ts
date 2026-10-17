export const noteCommands = [
  {
    name: "/remind",
    description: "Send a note with a reminder",
    example: "/remind 10m Take a break",
  },
];

export function parseNoteCommand(
  content: string,
): { content: string; delay: number } | null {
  if (!/^\/remind(?:\s|$)/i.test(content)) return null;
  const body = content.replace(/^\/remind\s*/i, "");
  const match = body.match(/^(\d+)(m|h|d)\s+([\s\S]+)$/i);
  if (!match) return { content: body, delay: 10 };
  const unit = { m: 1, h: 60, d: 1440 }[match[2].toLowerCase()] ?? 1;
  return {
    content: match[3],
    delay: Math.min(525600, Math.max(1, Number(match[1]) * unit)),
  };
}
