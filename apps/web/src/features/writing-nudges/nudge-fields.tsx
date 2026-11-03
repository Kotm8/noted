import { useQuery } from "@tanstack/react-query";
import { PenLine } from "lucide-react";
import { Select } from "../../components/ui/select";
import { workspaceApi } from "../workspaces/api";
import { useAllChannels } from "../workspaces/hooks/use-all-channels";
import { defaultWritingNudge, type WritingNudgeSettings } from "./types";
import "./nudges.css";

export function NudgeFields({
  value,
  onChange,
  inherit = false,
}: {
  value: WritingNudgeSettings | null | undefined;
  onChange: (value: WritingNudgeSettings | null) => void;
  inherit?: boolean;
}) {
  const channels = useAllChannels();
  const projects = useQuery({
    queryKey: ["workspaces"],
    queryFn: workspaceApi.list,
  });
  const config = value ?? defaultWritingNudge;
  function change<K extends keyof WritingNudgeSettings>(
    key: K,
    next: WritingNudgeSettings[K],
  ) {
    onChange({ ...config, [key]: next });
  }
  return (
    <fieldset className="nudge-fields">
      <legend>
        <PenLine size={14} /> Writing nudges
      </legend>
      <Select
        label="Writing nudges"
        value={
          inherit && value == null ? "inherit" : config.enabled ? "on" : "off"
        }
        options={[
          ...(inherit
            ? [{ value: "inherit", label: "Use activity settings" }]
            : []),
          { value: "off", label: "Off" },
          { value: "on", label: "Every N minutes of tracked time" },
        ]}
        onChange={(next) =>
          onChange(
            next === "inherit" ? null : { ...config, enabled: next === "on" },
          )
        }
      />
      {value?.enabled && (
        <div className="nudge-options">
          <label className="nudge-interval">
            Nudge every
            <input
              aria-label="Nudge interval in minutes"
              type="number"
              required
              min={1}
              max={1440}
              value={config.interval_minutes}
              onChange={(event) =>
                change("interval_minutes", Number(event.target.value))
              }
            />
            <span>tracked minutes</span>
          </label>
          <div className="schedule-field">
            <span className="field-caption">Write in</span>
            <Select
              label="Nudge channel"
              value={config.channel_id ?? ""}
              options={[
                { value: "", label: "Choose a channel" },
                ...(channels ?? []).map((channel) => ({
                  value: channel.id,
                  label: `${projects.data?.find((project) => project.id === channel.workspace_id)?.name ?? "Project"} / #${channel.name}`,
                })),
              ]}
              onChange={(next) => change("channel_id", next || null)}
            />
          </div>
          <label>
            Message
            <input
              required
              maxLength={500}
              value={config.content}
              onChange={(event) => change("content", event.target.value)}
            />
          </label>
          <label className="nudge-stop">
            <input
              type="checkbox"
              checked={config.on_stop}
              onChange={(event) => change("on_stop", event.target.checked)}
            />
            Also nudge when I stop or switch activity
          </label>
          <p className="schedule-help">
            Pauses do not count. Writing in this channel restarts the countdown.
          </p>
        </div>
      )}
    </fieldset>
  );
}
