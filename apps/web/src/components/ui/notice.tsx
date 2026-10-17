import type { ReactNode } from "react";
import { CircleAlert, Info, TriangleAlert } from "lucide-react";

interface NoticeProps {
  children: ReactNode;
  tone?: "info" | "warning" | "error";
  role?: "status" | "alert" | "note";
  className?: string;
}

export function Notice({ children, tone = "info", role, className = "" }: NoticeProps) {
  const Icon = tone === "error" ? CircleAlert : tone === "warning" ? TriangleAlert : Info;

  return (
    <div
      className={`notice notice-${tone} ${className}`.trim()}
      role={role ?? (tone === "error" ? "alert" : "status")}
    >
      <Icon className="notice-icon" size={17} aria-hidden="true" />
      <div className="notice-content">{children}</div>
    </div>
  );
}
