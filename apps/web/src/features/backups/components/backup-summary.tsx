import type { BackupCounts } from "../types";

export function BackupSummary({ counts }: { counts: BackupCounts }) {
  return (
    <dl className="backup-counts">
      {Object.entries({
        Projects: counts.projects,
        Categories: counts.categories,
        Channels: counts.channels,
        Messages: counts.messages,
        Files: counts.files,
      }).map(([label, count]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{count.toLocaleString()}</dd>
        </div>
      ))}
    </dl>
  );
}
