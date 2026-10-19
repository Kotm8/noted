import {
  Activity as ActivityGlyph,
  BookOpen,
  BriefcaseBusiness,
  Code2,
  Coffee,
  Flag,
  Laptop,
  Moon,
  Sun,
  Trees,
} from "lucide-react";
import type { CSSProperties } from "react";
import type { Activity, ActivityIconName } from "../types";

const icons = {
  Activity: ActivityGlyph,
  BookOpen,
  BriefcaseBusiness,
  Code2,
  Coffee,
  Flag,
  Laptop,
  Moon,
  Sun,
  Trees,
};
export function ActivityGlyphIcon({ name }: { name: ActivityIconName }) {
  const Icon = icons[name] ?? ActivityGlyph;
  return <Icon size={16} />;
}
export function ActivityIcon({ activity }: { activity: Activity }) {
  return (
    <span
      className="activity-mark"
      style={{ "--activity": activity.color } as CSSProperties}
    >
      <ActivityGlyphIcon name={activity.icon} />
    </span>
  );
}
