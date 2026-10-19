import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "../../components/ui/button";
import { Notice } from "../../components/ui/notice";
import { Select } from "../../components/ui/select";
import {
  DateTimePicker,
  localDateTime,
} from "../../components/ui/date-time-picker";
import { publishingApi } from "./api";
import type { WritingFields, WritingPrompt } from "./types";

export function WritingPromptForm({
  channelId,
  initial,
}: {
  channelId: string;
  initial: WritingPrompt | null;
}) {
  const client = useQueryClient();
  const [content, setContent] = useState(
    initial?.content ?? "Take a moment to write something.",
  );
  const [time, setTime] = useState(() =>
    localDateTime(new Date(initial?.start_at ?? Date.now() + 3600000)),
  );
  const [frequency, setFrequency] = useState<WritingFields["frequency"]>(
    initial?.frequency ?? "daily",
  );
  const [weekdays, setWeekdays] = useState(
    initial?.weekdays ?? [(new Date().getDay() + 6) % 7],
  );
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [revision, setRevision] = useState(initial?.revision ?? 0);
  const save = useMutation({
    mutationFn: () =>
      publishingApi.saveWriting(channelId, revision, {
        content,
        start_at: new Date(time).toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        frequency,
        weekdays,
        enabled,
      }),
    onSuccess: async (prompt) => {
      setRevision(prompt.revision);
      await Promise.all([
        client.invalidateQueries({ queryKey: ["publishing"] }),
        client.invalidateQueries({ queryKey: ["home-activity"] }),
      ]);
      toast.success("Writing prompt saved");
    },
  });
  const customDays = frequency === "weekly" || frequency === "biweekly";
  return (
    <form
      className="writing-prompt-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!save.isPending) save.mutate();
      }}
    >
      <p className="field-caption">
        A recurring nudge to write here. Posting a note, replying, or saving
        journal or Notes content completes the current prompt.
      </p>
      <label>
        Prompt
        <textarea
          aria-label="Writing prompt text"
          value={content}
          onChange={(event) => setContent(event.target.value)}
          maxLength={500}
          rows={2}
          required
        />
      </label>
      <label>
        Repeat
        <Select
          label="Writing prompt repeat"
          value={frequency}
          onChange={(next) => setFrequency(next as WritingFields["frequency"])}
          options={[
            { value: "daily", label: "Every day" },
            { value: "weekly", label: "Every week" },
            { value: "biweekly", label: "Every two weeks" },
            { value: "monthly", label: "Every month" },
          ]}
        />
      </label>
      {customDays && (
        <div
          className="publishing-weekdays"
          role="group"
          aria-label="Writing days"
        >
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(
            (day, index) => (
              <button
                type="button"
                key={day}
                aria-pressed={weekdays.includes(index)}
                onClick={() =>
                  setWeekdays((current) =>
                    current.includes(index)
                      ? current.filter((value) => value !== index)
                      : [...current, index],
                  )
                }
              >
                {day}
              </button>
            ),
          )}
        </div>
      )}
      <DateTimePicker
        value={time}
        onChange={setTime}
        min=""
        label="Choose writing start date"
      />
      <p className="field-caption">
        Starts on this date, at this time in{" "}
        {Intl.DateTimeFormat().resolvedOptions().timeZone}. Missed occurrences
        are skipped.
      </p>
      <label className="publishing-enabled">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
        />
        Enable writing prompts
      </label>
      {save.error && <Notice tone="error">{save.error.message}</Notice>}
      <div className="dialog-actions">
        <Button
          disabled={
            !content.trim() ||
            save.isPending ||
            (customDays && !weekdays.length)
          }
          type="submit"
        >
          {save.isPending ? "Saving…" : "Save writing prompt"}
        </Button>
      </div>
    </form>
  );
}
