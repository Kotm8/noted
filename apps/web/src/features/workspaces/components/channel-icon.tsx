import { Bell, BookOpen, FileText, Hash, ListChecks } from "lucide-react";
import type { Channel } from "../types";

const icons = {
  note: Hash,
  reminder: Bell,
  journal: BookOpen,
  document: FileText,
  tasks: ListChecks,
};

export function ChannelIcon({
  kind,
  size,
}: {
  kind: Channel["kind"];
  size: number;
}) {
  const Icon = icons[kind ?? "note"];
  return <Icon size={size} strokeWidth={1.75} />;
}
