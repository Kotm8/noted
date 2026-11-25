import { useState } from "react";
import { Check, Plus } from "lucide-react";
import { Modal } from "../../../components/ui/dialog";
import { Notice } from "../../../components/ui/notice";
import { useTracking } from "../../time-tracking/use-tracking";
import { PlannedTaskPrompt } from "../../time-tracking/components/planned-task-prompt";
import {
  usePlanPrompts,
  usePromptAction,
  type PlanPrompt,
} from "../../schedule/prompts";
import type { ScheduleBoard } from "../../schedule/types";
import { zonedParts } from "../../schedule/dates";
import { HomeReminderActions } from "../reminder-actions";
import { useHomeActivity } from "../use-home-activity";
import type { HomeActivity } from "../types";
import { NewHomeReminder } from "./new-home-reminder";

function PromptRow({
  prompt,
  onDelay,
  color,
}: {
  prompt: PlanPrompt;
  onDelay: () => void;
  color?: string;
}) {
  const action = usePromptAction(prompt);
  return (
    <div className="home-need-row home-need-plan">
      <span className="home-need-dot" style={{ background: color }} />
      <div>
        <strong>{prompt.title}</strong>
        <small>
          {prompt.phase === "end"
            ? "Planned activity ended"
            : "Planned activity is ready"}
        </small>
      </div>
      <button
        className="home-small-button home-start-button"
        disabled={action.isPending}
        onClick={() =>
          action.mutate({ action: prompt.phase === "end" ? "stop" : "start" })
        }
      >
        {prompt.phase === "end" ? "No activity" : "Start"}
      </button>
      <button className="home-small-button" onClick={onDelay}>
        {prompt.phase === "end" ? "Snooze" : "Delay"}
      </button>
    </div>
  );
}

export function HomeNeeds({
  timezone,
  board,
  onOpen,
  compact = false,
}: {
  timezone: string;
  board?: ScheduleBoard;
  onOpen: (item: HomeActivity) => void;
  compact?: boolean;
}) {
  const [creating, setCreating] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [delaying, setDelaying] = useState<PlanPrompt | null>(null);
  const tracking = useTracking();
  const prompts = usePlanPrompts();
  const activity = useHomeActivity(200);
  const today = zonedParts(Date.now(), timezone).date;
  const items = new Map<string, HomeActivity>();
  for (const flag of board?.reminders ?? []) {
    if (zonedParts(flag.due_at, timezone).date !== today) continue;
    items.set(`reminder:${flag.message_id}`, {
      kind: "reminder",
      id: flag.message_id,
      revision: flag.revision ?? 1,
      title: flag.content || "Attachment reminder",
      due_at: flag.due_at,
      read: true,
      workspace_id: flag.workspace_id,
      workspace_name: flag.workspace_name,
      channel_id: flag.channel_id,
      channel_name: flag.channel_name,
    });
  }
  for (const item of activity.query.data?.items ?? []) {
    if (
      item.kind === "plan" &&
      prompts.data?.some((prompt) => prompt.id === item.id)
    )
      continue;
    items.set(`${item.kind}:${item.id}`, item);
  }
  const list = [...items.values()].sort(
    (a, b) => Date.parse(a.due_at) - Date.parse(b.due_at),
  );
  const previewSize = compact ? 2 : 5;
  return (
    <section
      className="home-b-section home-b-needs"
      aria-label="Needs you"
      id="missed"
    >
      <div className="home-b-section-heading">
        <h2>{compact ? "Reminders" : "Needs you"}</h2>
        <button className="home-text-button" onClick={() => setCreating(true)}>
          <Plus size={13} />
          Reminder
        </button>
      </div>
      {prompts.data?.map((prompt) => (
        <PromptRow
          key={`${prompt.id}:${prompt.revision}`}
          prompt={prompt}
          color={
            tracking.activities.data?.find(
              (activity) => activity.id === prompt.activity_id,
            )?.color
          }
          onDelay={() => setDelaying(prompt)}
        />
      ))}
      {(expanded ? list : list.slice(0, previewSize)).map((item) => (
        <div
          className={`home-need-row ${item.read ? "is-read" : ""}`}
          key={`${item.kind}:${item.id}`}
        >
          {item.kind === "reminder" && (
            <HomeReminderActions
              id={item.id}
              revision={item.revision}
              layout="checkbox"
            />
          )}
          <button
            className="home-need-content"
            onClick={() => {
              if (!item.read) activity.read.mutate([item]);
              onOpen(item);
            }}
          >
            <strong>{item.title}</strong>
            <small
              className={
                item.kind === "reminder" && Date.parse(item.due_at) < Date.now()
                  ? "overdue"
                  : undefined
              }
            >
              {item.kind === "plan"
                ? "Planned activity"
                : item.kind === "reminder"
                  ? `Reminder · ${new Date(item.due_at).toLocaleString([], { timeZone: timezone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })}`
                  : item.kind === "habit"
                    ? "Habit reminder"
                    : `${item.workspace_name} / #${item.channel_name}`}
            </small>
          </button>
          {item.kind === "reminder" ? (
            <HomeReminderActions
              id={item.id}
              revision={item.revision}
              layout="snooze"
            />
          ) : (
            <button className="home-small-button" onClick={() => onOpen(item)}>
              {item.kind === "plan" ? "Choose activity" : "Open"}
            </button>
          )}
          {!item.read && (
            <button
              className="icon-button home-mark-read"
              title="Mark read"
              aria-label={`Mark read: ${item.title}`}
              disabled={activity.read.isPending}
              onClick={() => activity.read.mutate([item])}
            >
              <Check size={13} />
            </button>
          )}
        </div>
      ))}
      {list.length > previewSize && (
        <button
          className="home-text-button home-needs-more"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "Show less" : `Show all ${list.length} items`}
        </button>
      )}
      {activity.query.error && (
        <Notice tone="error">
          {activity.query.error.message}
          <button onClick={() => void activity.query.refetch()}>Retry</button>
        </Notice>
      )}
      {activity.query.isPending && (
        <p className="home-empty">Loading reminders…</p>
      )}
      {!activity.query.isPending &&
        !activity.query.error &&
        !list.length &&
        !prompts.data?.length && (
          <p className="home-empty">Nothing waiting right now.</p>
        )}
      {activity.query.data?.has_more && (
        <p className="home-empty">
          Showing the latest 200 items. Complete reminders to clear older ones.
        </p>
      )}
      {creating && <NewHomeReminder onClose={() => setCreating(false)} />}
      {delaying && (
        <Modal
          open
          title="Delay activity"
          description={delaying.title}
          onOpenChange={(open) => {
            if (!open) setDelaying(null);
          }}
        >
          <PlannedTaskPrompt
            key={`${delaying.id}:${delaying.revision}`}
            prompt={delaying}
            activities={tracking.activities.data ?? []}
            timezone={timezone}
            initialMode="delay"
            close={() => setDelaying(null)}
          />
        </Modal>
      )}
    </section>
  );
}
