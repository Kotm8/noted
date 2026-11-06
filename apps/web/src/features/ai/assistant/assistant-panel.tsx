import { FieldChanges } from "./field-changes";
import { scheduleApi } from "../../schedule/api";
import { useTracking } from "../../time-tracking/use-tracking";
import { useEffect, useRef } from "react";
import {
  ArrowUp,
  BookmarkCheck,
  Check,
  History,
  CornerDownRight,
  ImagePlus,
  LoaderCircle,
  MessageSquare,
  PenLine,
  Settings,
  Sparkles,
  Square,
  SquarePen,
  Trash2,
  X,
} from "lucide-react";
import { Menu, MenuItem } from "../../../components/ui/menu";
import { Markdown } from "../../notes/components/markdown";
import { photoUrl } from "../../nutrition/api";
import { AiSources } from "../components/ai-feedback";
import { cleanCitations } from "../citations";
import { useAiPrompts } from "../queries";
import { KINDS } from "../kinds";
import type { AttachedSummary } from "./types";
import { useQuery, useQueries } from "@tanstack/react-query";
import { Button } from "../../../components/ui/button";
import { Notice } from "../../../components/ui/notice";
import { DatePicker } from "../../../components/ui/date-picker";
import { useAndroidBackLayer } from "../../../lib/android-navigation";
import { habitsApi } from "../../habits/api";
import { dayLabel, minuteLabel } from "../../schedule/dates";
import type { useSharedAssistant } from "./use-assistant";

function AttachedLabel({ attached }: { attached: AttachedSummary }) {
  const count = attached.message_ids.length;
  return (
    <small className="shared-ai-about">
      {attached.thread_root_id ? (
        <MessageSquare size={12} />
      ) : (
        <CornerDownRight size={12} />
      )}
      {attached.thread_root_id
        ? "In a thread"
        : `${count} message${count === 1 ? "" : "s"}`}{" "}
      in #{attached.channel_name}
    </small>
  );
}

export function AssistantPanel({
  assistant: a,
}: {
  assistant: ReturnType<typeof useSharedAssistant>;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  useAndroidBackLayer(a.open, () => a.setOpen(false));
  useEffect(() => {
    scroll.current?.scrollTo({ top: scroll.current.scrollHeight });
  }, [a.proposal, a.busy, a.turns.length, a.streaming]);
  useEffect(() => {
    if (a.focusRequest) requestAnimationFrame(() => input.current?.focus());
  }, [a.focusRequest]);
  const uploading = a.pictures.some((item) => item.id === null);
  const prompts = useAiPrompts(Boolean(a.open && a.connected));
  const quick = a.attached
    ? (prompts.data ?? []).filter((item) => item.places.includes("messages"))
    : [];
  const changeCount = a.proposal
    ? a.proposal.habits.length +
      a.proposal.plans.length +
      a.proposal.meals.length +
      (a.proposal.rewrites?.length ?? 0)
    : 0;
  const habits = useQuery({
    queryKey: ["habits", "assistant-context", a.scope?.start, a.scope?.end],
    queryFn: () => habitsApi.board(a.scope!.start, a.scope!.end),
    enabled: a.open && Boolean(a.scope),
  });
  const tracking = useTracking();
  const activityNames = new Map(
    (tracking.activities.data ?? []).map((item) => [item.id, item.name]),
  );
  const existingPlans = useQueries({
    queries: (a.proposal?.plans ?? [])
      .filter((item) => item.id)
      .map((item) => ({
        queryKey: ["schedule-plan", item.id],
        queryFn: () => scheduleApi.get(item.id!),
        enabled: a.open,
      })),
  });
  if (!a.open) return null;
  return (
    <aside
      className="shared-ai-panel"
      aria-label="AI assistant"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          a.setOpen(false);
        }
      }}
    >
      <header>
        <Sparkles size={16} />
        <strong>Assistant</strong>
        <button
          className="icon-button"
          aria-label="New chat"
          title="New chat"
          disabled={a.busy || !a.turns.length}
          onClick={a.newChat}
        >
          <SquarePen size={16} />
        </button>
        <Menu
          trigger={
            <button
              className="icon-button"
              aria-label="Earlier chats"
              title="Earlier chats"
              disabled={a.busy}
            >
              <History size={16} />
            </button>
          }
        >
          {a.chats.length === 0 && (
            <MenuItem disabled onSelect={() => undefined}>
              No earlier chats
            </MenuItem>
          )}
          {a.chats.map((chat) => (
            <MenuItem key={chat.id} onSelect={() => a.openChat(chat.id)}>
              <span className="shared-ai-chat-item">
                <span>{chat.title}</span>
                <small>
                  {new Date(chat.updated_at).toLocaleDateString([], {
                    day: "numeric",
                    month: "short",
                  })}
                </small>
              </span>
            </MenuItem>
          ))}
          {a.chatId && (
            <MenuItem danger onSelect={() => a.deleteChat(a.chatId!)}>
              <Trash2 size={14} />
              Delete this chat
            </MenuItem>
          )}
        </Menu>
        <button
          className="icon-button"
          aria-label="AI settings"
          onClick={() => window.dispatchEvent(new Event("noted:ai-settings"))}
        >
          <Settings size={16} />
        </button>
        <button
          className="icon-button"
          aria-label="Close assistant"
          onClick={() => a.setOpen(false)}
        >
          <X size={18} />
        </button>
      </header>
      <div className="shared-ai-scroll" ref={scroll}>
        {a.scope && !a.attached && (
          <details className="shared-ai-range">
            <summary>
              {dayLabel(a.scope.start, { day: "numeric", month: "short" })} to{" "}
              {dayLabel(a.scope.end, { day: "numeric", month: "short" })}
            </summary>
            <label>
              From
              <DatePicker
                value={a.scope.start}
                label="AI start date"
                onChange={(start) => a.setScope({ ...a.scope!, start })}
              />
            </label>
            <label>
              To
              <DatePicker
                value={a.scope.end}
                label="AI end date"
                onChange={(end) => a.setScope({ ...a.scope!, end })}
              />
            </label>
          </details>
        )}
        {a.loadingChat && (
          <p className="habit-help" role="status">
            Loading the chat…
          </p>
        )}
        {a.turns.length === 0 && !a.loadingChat && (
          <p className="shared-ai-intro">
            Ask about your notes, habits, meals or calendar, or add a picture of
            a meal to log it. Changes appear here for review.
          </p>
        )}
        {a.turns.map((turn, i) =>
          turn.role === "user" ? (
            <div className="shared-ai-turn user" key={turn.id ?? i}>
              {turn.photo_ids && turn.photo_ids.length > 0 && (
                <div className="shared-ai-pictures">
                  {turn.photo_ids.map((id) => (
                    <img
                      key={id}
                      src={photoUrl(id)}
                      alt="Attached picture"
                      onError={(event) => {
                        event.currentTarget.hidden = true;
                      }}
                    />
                  ))}
                </div>
              )}
              {turn.attached && <AttachedLabel attached={turn.attached} />}
              {turn.content}
            </div>
          ) : (
            <div className="shared-ai-turn assistant" key={turn.id ?? i}>
              <Markdown content={cleanCitations(turn.content)} />
              {turn.proposal?.posted && (
                <small className="shared-ai-note">
                  <CornerDownRight size={13} />
                  Replied in the thread
                </small>
              )}
              {turn.proposal?.reply && !turn.proposal.posted && (
                <div className="shared-ai-draft">
                  <small>Reply</small>
                  <Markdown content={turn.proposal.reply} />
                </div>
              )}
              {turn.proposal?.draft && (
                <div className="shared-ai-draft">
                  <small>Draft</small>
                  <Markdown content={turn.proposal.draft} />
                  {a.attached && i === a.turns.length - 1 && (
                    <Button
                      size="small"
                      variant="secondary"
                      onClick={() => a.putDraft(turn.proposal!.draft!)}
                    >
                      <PenLine size={14} />
                      {a.attached.threadRootId
                        ? "Put in reply box"
                        : "Put in message box"}
                    </Button>
                  )}
                </div>
              )}
              {turn.remembered?.map((text) => (
                <small className="shared-ai-note" key={text}>
                  <BookmarkCheck size={13} />
                  Remembered: {text}
                </small>
              ))}
              {turn.applied && (
                <small className="shared-ai-note">
                  <Check size={13} />
                  Changes applied
                </small>
              )}
              {i < a.turns.length - 1 && turn.sources && (
                <AiSources sources={turn.sources} />
              )}
            </div>
          ),
        )}
        {a.busy && a.streaming !== null && (
          <div className="shared-ai-turn assistant" aria-live="polite">
            <div className="shared-ai-streaming">
              <Markdown content={cleanCitations(a.streaming)} />
            </div>
          </div>
        )}
        {a.busy && a.streaming === null && (
          <p className="shared-ai-stage" role="status">
            <LoaderCircle size={14} className="spin" />
            <span className="ai-shimmer">{a.stage || "Thinking…"}</span>
          </p>
        )}
        {a.proposal && (
          <div className="shared-ai-changes">
            {(a.proposal.rewrites ?? []).map((change, index) => (
              <label className="shared-ai-change" key={`rewrite-${index}`}>
                <input
                  type="checkbox"
                  aria-label={`Include rewrite ${index + 1}`}
                  disabled={a.applied || a.applying || a.retryPending}
                  checked={a.selected.has(`rewrite-${index}`)}
                  onChange={(event) =>
                    a.setSelected((current) => {
                      const next = new Set(current);
                      if (event.target.checked) next.add(`rewrite-${index}`);
                      else next.delete(`rewrite-${index}`);
                      return next;
                    })
                  }
                />
                <span className="shared-ai-rewrite">
                  <small>Rewrite message</small>
                  {a.originalOf(change.id) !== undefined && (
                    <del>{a.originalOf(change.id)}</del>
                  )}
                  <ins>{change.text}</ins>
                </span>
              </label>
            ))}
            {a.proposal.habits.map((change, index) => {
              const old = habits.data?.habits.find(
                (item) => item.id === change.id,
              );
              return (
                <label className="shared-ai-change" key={`habit-${index}`}>
                  <input
                    type="checkbox"
                    aria-label={`Include ${change.fields.name}`}
                    disabled={a.applied || a.applying || a.retryPending}
                    checked={a.selected.has(`habit-${index}`)}
                    onChange={(event) =>
                      a.setSelected((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(`habit-${index}`);
                        else next.delete(`habit-${index}`);
                        return next;
                      })
                    }
                  />
                  <span>
                    <small>{change.id ? "Edit habit" : "New habit"}</small>
                    <strong>{change.fields.name}</strong>
                    {old && (
                      <small>
                        Current: {old.goal} {old.unit},{" "}
                        {old.weekdays
                          .map(
                            (i) =>
                              ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][
                                i
                              ],
                          )
                          .join(", ")}
                      </small>
                    )}
                    <span>
                      {change.fields.kind === "check"
                        ? "Check off"
                        : `${change.fields.goal} ${change.fields.unit}`}{" "}
                      ·{" "}
                      {change.fields.weekdays
                        .map(
                          (i) =>
                            ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][
                              i
                            ],
                        )
                        .join(", ")}
                    </span>
                    <FieldChanges
                      before={old}
                      after={change.fields}
                      activities={activityNames}
                    />
                    <small>
                      {change.fields.reminder_minute === null
                        ? "Reminders off"
                        : `Reminder ${minuteLabel(change.fields.reminder_minute)}`}
                    </small>
                  </span>
                </label>
              );
            })}
            {a.proposal.meals.map((change, index) => {
              const total = change.fields.items.reduce(
                (sum, item) => sum + item.kcal,
                0,
              );
              return (
                <label className="shared-ai-change" key={`meal-${index}`}>
                  <input
                    type="checkbox"
                    aria-label={`Include ${change.fields.name}`}
                    disabled={a.applied || a.applying || a.retryPending}
                    checked={a.selected.has(`meal-${index}`)}
                    onChange={(event) =>
                      a.setSelected((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(`meal-${index}`);
                        else next.delete(`meal-${index}`);
                        return next;
                      })
                    }
                  />
                  <span>
                    <small>{change.id ? "Edit meal" : "Log meal"}</small>
                    {change.photo_ids?.[0] && (
                      <img
                        className="shared-ai-change-picture"
                        src={photoUrl(change.photo_ids[0])}
                        alt=""
                      />
                    )}
                    <strong>{change.fields.name}</strong>
                    <span>
                      {change.fields.slot} ·{" "}
                      {String(Math.floor(change.fields.minute / 60)).padStart(
                        2,
                        "0",
                      )}
                      :{String(change.fields.minute % 60).padStart(2, "0")} ·{" "}
                      {Math.round(total).toLocaleString("en-GB")} kcal
                      {change.picture && " · makes a picture"}
                    </span>
                    <small>
                      {change.fields.items
                        .map((item) => `${item.name} ${item.kcal}`)
                        .join(" · ")}
                    </small>
                  </span>
                </label>
              );
            })}
            {a.proposal.plans.map((change, index) => (
              <label className="shared-ai-change" key={`plan-${index}`}>
                <input
                  type="checkbox"
                  aria-label={`Include ${change.fields.title}`}
                  disabled={a.applied || a.applying || a.retryPending}
                  checked={a.selected.has(`plan-${index}`)}
                  onChange={(event) =>
                    a.setSelected((current) => {
                      const next = new Set(current);
                      if (event.target.checked) next.add(`plan-${index}`);
                      else next.delete(`plan-${index}`);
                      return next;
                    })
                  }
                />
                <span>
                  <small>
                    {change.id
                      ? change.scope === "occurrence"
                        ? "Edit this occurrence"
                        : "Edit calendar plan"
                      : "New calendar plan"}
                  </small>
                  <button
                    type="button"
                    className="shared-ai-plan-title"
                    disabled={
                      a.applied || a.applying || a.retryPending || a.busy
                    }
                    onClick={(event) => {
                      event.preventDefault();
                      window.dispatchEvent(
                        new CustomEvent("noted:assistant-edit-plan", {
                          detail: {
                            index,
                            anchor: event.currentTarget.getBoundingClientRect(),
                          },
                        }),
                      );
                    }}
                  >
                    {change.fields.title}
                  </button>
                  <span>
                    {dayLabel(change.fields.date, {
                      day: "numeric",
                      month: "short",
                    })}{" "}
                    · {minuteLabel(change.fields.start_minute)}–
                    {minuteLabel(change.fields.end_minute)}
                  </span>
                  {a.conflicts.has(`assistant-${index}`) && (
                    <span className="shared-ai-conflict">
                      <span>{a.conflicts.get(`assistant-${index}`)}</span>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.preventDefault();
                          a.findGap(index);
                        }}
                      >
                        Find a gap
                      </button>
                    </span>
                  )}
                  <FieldChanges
                    before={
                      existingPlans.find(
                        (query) => query.data?.id === change.id,
                      )?.data
                    }
                    after={change.fields}
                    activities={activityNames}
                  />
                  <small>
                    {change.fields.frequency === "none"
                      ? "One-off"
                      : change.fields.frequency}{" "}
                    · {change.fields.timezone}
                  </small>
                </span>
              </label>
            ))}
          </div>
        )}
        <AiSources sources={a.sources} />
        {a.error && <Notice tone="error">{a.error}</Notice>}
      </div>
      <div className="shared-ai-bottom">
        {changeCount > 0 && (
          <div className="shared-ai-review">
            {a.applied ? (
              <span>
                <Check size={15} />
                Applied
              </span>
            ) : (
              <>
                <span>{a.selected.size} selected</span>
                <Button
                  disabled={
                    a.applying ||
                    a.busy ||
                    !a.selected.size ||
                    (a.conflicts.size > 0 && !a.retryPending)
                  }
                  onClick={() => void a.apply()}
                >
                  {a.applying
                    ? "Applying…"
                    : a.retryPending
                      ? "Retry saving"
                      : "Apply changes"}
                </Button>
              </>
            )}
          </div>
        )}
        {a.attached && (
          <div className="shared-ai-context">
            {a.attached.threadRootId ? (
              <MessageSquare size={14} />
            ) : (
              <CornerDownRight size={14} />
            )}
            <span>
              <strong>
                {a.attached.threadRootId
                  ? "Thread"
                  : a.attached.notes.length === 1
                    ? "Message"
                    : `${a.attached.notes.length} messages`}{" "}
                in #{a.attached.channelName}
              </strong>
              <small>{a.attached.notes[0]?.content || "Picture"}</small>
            </span>
            <button
              type="button"
              className="icon-button"
              aria-label="Remove attached messages"
              title="Remove"
              disabled={a.busy}
              onClick={a.detach}
            >
              <X size={14} />
            </button>
          </div>
        )}
        {quick.length > 0 && !a.busy && !a.prompt.trim() && (
          <div className="shared-ai-quick" aria-label="Saved prompts">
            {quick.map((item) => (
              <button
                key={item.id}
                type="button"
                title={`${KINDS[item.kind].label}: ${item.instructions}`}
                disabled={a.applying || a.retryPending}
                onClick={() => void a.ask({ id: item.id, name: item.name })}
              >
                {item.name}
              </button>
            ))}
          </div>
        )}
        <form
          className="shared-ai-composer"
          onSubmit={(event) => {
            event.preventDefault();
            void a.ask();
          }}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            a.addPictures(event.dataTransfer.files);
          }}
        >
          {a.pictures.length > 0 && (
            <div className="shared-ai-attached">
              {a.pictures.map((picture) => (
                <span key={picture.key}>
                  <img src={picture.preview} alt="Picture to send" />
                  {picture.id === null && (
                    <LoaderCircle size={16} className="spin" />
                  )}
                  <button
                    type="button"
                    aria-label="Remove picture"
                    onClick={() => a.removePicture(picture.key)}
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <button
            type="button"
            className="icon-button"
            aria-label="Add a picture"
            title="Add a picture"
            disabled={
              a.busy || a.applying || a.pictures.length >= a.maxPictures
            }
            onClick={() => gallery.current?.click()}
          >
            <ImagePlus size={17} />
          </button>
          <input
            ref={gallery}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(event) => {
              if (event.target.files) a.addPictures(event.target.files);
              event.target.value = "";
            }}
          />
          <textarea
            ref={input}
            aria-label="Message assistant"
            rows={1}
            placeholder={
              a.attached
                ? a.attached.threadRootId
                  ? "Ask, and the reply goes in the thread…"
                  : "What should the AI do with this?"
                : "Ask, or add a picture of a meal…"
            }
            value={a.prompt}
            disabled={a.busy || a.applying || a.retryPending}
            onChange={(event) => a.setPrompt(event.target.value)}
            onPaste={(event) => {
              const files = Array.from(event.clipboardData.files);
              if (files.some((file) => file.type.startsWith("image/"))) {
                event.preventDefault();
                a.addPictures(files);
              }
            }}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                void a.ask();
              }
            }}
          />
          {a.busy ? (
            <button
              className="icon-button"
              type="button"
              aria-label="Stop assistant"
              onClick={a.cancel}
            >
              <Square size={16} />
            </button>
          ) : (
            <button
              className="shared-ai-send"
              aria-label="Send to assistant"
              disabled={
                (!a.prompt.trim() && !a.pictures.length) ||
                uploading ||
                a.applying
              }
            >
              <ArrowUp size={18} />
            </button>
          )}
        </form>
      </div>
    </aside>
  );
}
