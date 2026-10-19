import type { BackupCounts } from "../types";

export function BackupSummary({ counts }: { counts: BackupCounts }) {
  return (
    <dl className="backup-counts">
      {Object.entries({
        Projects: counts.projects,
        Categories: counts.categories,
        Channels: counts.channels,
        Messages: counts.messages,
        Journals: counts.journals ?? 0,
        ...(counts.documents ? { "Notes pages": counts.documents } : {}),
        Files: counts.files,
        ...(counts.activities ? { Activities: counts.activities } : {}),
        ...(counts.time_sessions
          ? { "Time sessions": counts.time_sessions }
          : {}),
        ...(counts.schedule_plans
          ? { "Schedule plans": counts.schedule_plans }
          : {}),
        ...(counts.scheduled_messages
          ? { "Scheduled messages": counts.scheduled_messages }
          : {}),
        ...(counts.writing_prompts
          ? { "Writing prompts": counts.writing_prompts }
          : {}),
      }).map(([label, count]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{count.toLocaleString()}</dd>
        </div>
      ))}
    </dl>
  );
}
