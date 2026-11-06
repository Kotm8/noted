import { Check, ExternalLink, Trash2 } from "lucide-react";
import { Markdown } from "../../notes/components/markdown";
import { Select } from "../../../components/ui/select";
import { DatePicker } from "../../../components/ui/date-picker";
import { minuteLabel } from "../../schedule/dates";
import type { useSharedAssistant } from "./use-assistant";

export function ActionProposals({
  assistant: a,
}: {
  assistant: ReturnType<typeof useSharedAssistant>;
}) {
  const disabled = a.applied || a.applying || a.retryPending;
  const toggle = (key: string, checked: boolean) =>
    a.setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  return (
    <>
      {a.recordsApplied &&
        !a.applied &&
        a.proposal &&
        a.proposal.habits.length +
          a.proposal.plans.length +
          a.proposal.meals.length >
          0 && (
          <p className="shared-ai-note">
            Saved:{" "}
            {
              a.proposal.habits.filter((_, i) => a.selected.has(`habit-${i}`))
                .length
            }{" "}
            habit changes,{" "}
            {
              a.proposal.plans.filter((_, i) => a.selected.has(`plan-${i}`))
                .length
            }{" "}
            calendar changes,{" "}
            {
              a.proposal.meals.filter((_, i) => a.selected.has(`meal-${i}`))
                .length
            }{" "}
            meal changes.
          </p>
        )}
      {(a.proposal?.posts ?? []).map((post, i) => (
        <section className="shared-ai-action" key={`post-${i}`}>
          <label>
            <input
              type="checkbox"
              checked={a.selected.has(`post-${i}`)}
              disabled={disabled}
              onChange={(event) => toggle(`post-${i}`, event.target.checked)}
            />
            <span>
              Post to{" "}
              <strong>
                {post.destination
                  ? `${post.destination.workspace_name} / ${post.destination.category_name ? post.destination.category_name + " / " : ""}#${post.destination.channel_name}`
                  : post.channel_id}
              </strong>
            </span>
          </label>
          <Markdown content={post.text} />
        </section>
      ))}
      {(a.proposal?.deletions ?? []).map((item, i) => (
        <section className="shared-ai-action" key={`delete-${i}`}>
          <label>
            <input
              type="checkbox"
              checked={a.selected.has(`delete-${i}`)}
              disabled={disabled}
              onChange={(event) => toggle(`delete-${i}`, event.target.checked)}
            />
            <Trash2 size={14} />
            <span>
              Delete {item.kind}:{" "}
              <strong>{item.target?.title ?? item.id}</strong>
            </span>
          </label>
          {item.target?.channel_name && (
            <small>
              {item.target.workspace_name} / #{item.target.channel_name}
            </small>
          )}
          {item.target?.preview && (
            <details open>
              <summary>Show content to delete</summary>
              <Markdown content={item.target.preview} />
            </details>
          )}
          {item.kind === "message" && (
            <small>Replies in this message's thread are also removed.</small>
          )}
          {item.kind === "plan" && (
            <small>
              {item.target?.date} /{" "}
              {minuteLabel(item.target?.start_minute ?? 0)} to{" "}
              {minuteLabel(item.target?.end_minute ?? 0)} /{" "}
              {item.target?.timezone}
            </small>
          )}
          {item.kind === "plan" &&
            item.target?.frequency !== "none" &&
            !disabled && (
              <>
                <Select
                  label="Delete recurring plan"
                  value={item.scope ?? ""}
                  options={[
                    { value: "", label: "Choose what to delete" },
                    { value: "occurrence", label: "This occurrence" },
                    { value: "series", label: "Entire series" },
                  ]}
                  onChange={(value) =>
                    a.changeDeletion(i, {
                      scope: value as "occurrence" | "series",
                      occurrence_date:
                        value === "occurrence"
                          ? (item.occurrence_date ?? item.target?.date)
                          : null,
                    })
                  }
                />
                {item.scope === "occurrence" && (
                  <DatePicker
                    label="Occurrence to delete"
                    value={item.occurrence_date ?? item.target?.date ?? ""}
                    onChange={(value) =>
                      a.changeDeletion(i, { occurrence_date: value })
                    }
                  />
                )}
              </>
            )}
        </section>
      ))}
      {a.actionResults.map((item) => (
        <div className="shared-ai-action-result" role="status" key={item.key}>
          {item.ok ? (
            <>
              <Check size={14} />
              {item.key.startsWith("post-")
                ? "Posted"
                : item.key.startsWith("rewrite-")
                  ? "Rewritten"
                  : "Deleted"}
              {item.label && <span>{item.label}</span>}
              {item.url && (
                <a href={item.url}>
                  Open message
                  <ExternalLink size={12} />
                </a>
              )}
            </>
          ) : (
            <span>
              {item.label ?? item.key}: {item.error}
            </span>
          )}
        </div>
      ))}
    </>
  );
}
