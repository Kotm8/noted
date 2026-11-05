import { Notice } from "../../../components/ui/notice";
import { useAiStatus } from "../queries";

export function AiWritingError({
  message,
  code,
}: {
  message: string;
  code?: string | null;
}) {
  const status = useAiStatus();
  const usage = status.data?.usage;
  const reset =
    code === "limit"
      ? usage?.five_hours_percent !== null &&
        (usage?.five_hours_percent ?? 0) >= 100
        ? usage?.five_hours_resets_at
        : usage?.week_resets_at
      : null;
  return (
    <div className="ai-writing-error">
      <Notice tone="error">{message}</Notice>
      {reset && <small>Resets {new Date(reset).toLocaleString()}</small>}
      <button
        className="button-ghost"
        type="button"
        onClick={() => window.dispatchEvent(new Event("noted:ai-settings"))}
      >
        Open AI settings
      </button>
    </div>
  );
}
