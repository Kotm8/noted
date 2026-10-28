import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Watch } from "lucide-react";
import { request } from "../../lib/http";
import { Button } from "../../components/ui/button";
import { Notice } from "../../components/ui/notice";
import { Select } from "../../components/ui/select";
import { isAndroidApp } from "../notifications/android";

interface WatchSettings {
  face: "W07" | "W16" | "W24";
  accent: string;
  text_scale: number;
  schedule_hours: 2 | 4 | 6 | 8;
  hide_contents: boolean;
  favorites: string[];
}

/** Pairing happens in the Android app, which hands the ticket to the watch. */
export function WatchPairing() {
  const [message, setMessage] = useState("");
  const pair = useMutation({
    mutationFn: () => request<{ ticket: string }>("/wear/pairings", "POST"),
    onSuccess: ({ ticket }) => {
      const parameters = new URLSearchParams({
        origin: window.location.origin,
        ticket,
      });
      window.location.href = `intent://watch/connect?${parameters}#Intent;scheme=noted;package=com.noted.android;end`;
      setMessage("Choose your watch in the Android pairing screen.");
    },
  });
  return (
    <fieldset className="settings-fieldset">
      <legend>Connect your watch</legend>
      <p>
        Install the Noted watch app, then pair it from the Noted Android app.
        The watch gets its own session, which you can revoke in Server ›
        Sessions. On Wear OS 6 or newer, install the included face from Watch
        settings inside the watch app. No separate face APK is needed.
      </p>
      {isAndroidApp() ? (
        <Button disabled={pair.isPending} onClick={() => pair.mutate()}>
          <Watch size={16} />
          {pair.isPending ? "Preparing..." : "Pair watch"}
        </Button>
      ) : (
        <Notice>Open Settings › Devices in the Noted Android app to pair.</Notice>
      )}
      {pair.error && <Notice tone="error">{pair.error.message}</Notice>}
      {message && <p className="settings-hint">{message}</p>}
      <p className="settings-hint">
        Pairing and task controls work without Firebase. Background push uses
        this server's Android notification configuration.
      </p>
    </fieldset>
  );
}

export function WatchAppearancePanel() {
  const client = useQueryClient();
  const [message, setMessage] = useState("");
  const [draft, setDraft] = useState<WatchSettings | null>(null);
  const settings = useQuery({
    queryKey: ["watch-settings"],
    queryFn: () => request<WatchSettings>("/wear/settings"),
  });
  const activities = useQuery({
    queryKey: ["watch-activities"],
    queryFn: () =>
      request<Array<{ id: string; name: string }>>("/time-tracking/activities"),
  });
  const save = useMutation({
    scope: { id: "watch-settings" },
    mutationFn: (value: WatchSettings) =>
      request<WatchSettings>("/wear/settings", "PUT", value),
    onMutate: (value) => {
      const previous = client.getQueryData<WatchSettings>(["watch-settings"]);
      client.setQueryData(["watch-settings"], value);
      return { previous };
    },
    onError: (_error, _value, context) => {
      if (context?.previous) {
        client.setQueryData(["watch-settings"], context.previous);
        setDraft(context.previous);
      }
    },
    onSuccess: (value) => {
      client.setQueryData(["watch-settings"], value);
      setDraft(value);
      setMessage("Watch preferences saved.");
    },
  });
  const value = draft ?? settings.data;
  function update(change: Partial<WatchSettings>) {
    if (!value || save.isPending) return;
    const next = { ...value, ...change };
    setDraft(next);
    setMessage("");
    save.mutate(next);
  }
  return (
    <section className="settings-panel">
      <h2>Watch appearance</h2>
      <p>
        How the Noted watch face and app look. Saved to your account, and the
        watch picks changes up on its next sync. Time is always shown in
        24-hour format.
      </p>
      {settings.isPending && <p role="status">Loading watch preferences...</p>}
      {(settings.error || save.error) && (
        <Notice tone="error">
          {(settings.error || save.error)?.message}
        </Notice>
      )}
      {value && (
        <>
          <fieldset className="settings-fieldset" disabled={save.isPending}>
            <legend>Watch face content</legend>
            <label className="color-control">
              <span>Accent</span>
              <input
                aria-label="Watch accent"
                type="color"
                value={value.accent}
                disabled={save.isPending}
                onChange={(event) => update({ accent: event.target.value })}
              />
            </label>
            <label>
              Text size
              <Select
                label="Watch text size"
                value={String(value.text_scale)}
                options={[
                  { value: "0.85", label: "Small" },
                  { value: "1", label: "Normal" },
                  { value: "1.15", label: "Large" },
                  { value: "1.3", label: "Larger" },
                ]}
                onChange={(text) => update({ text_scale: Number(text) })}
              />
            </label>
            <label>
              Schedule window
              <Select
                label="Watch schedule window"
                value={String(value.schedule_hours)}
                options={[2, 4, 6, 8].map((hours) => ({
                  value: String(hours),
                  label: `${hours} hours`,
                }))}
                onChange={(hours) =>
                  update({
                    schedule_hours: Number(
                      hours,
                    ) as WatchSettings["schedule_hours"],
                  })
                }
              />
            </label>
            <label className="notification-enabled">
              <input
                type="checkbox"
                checked={value.hide_contents}
                disabled={save.isPending}
                onChange={(event) =>
                  update({ hide_contents: event.target.checked })
                }
              />
              Hide task names and reminder contents on the watch face
            </label>
            <p className="settings-hint">
              Pick the face on the watch: hold it, then Customize. Noted has
              ten: Hero, Planned ring, Big timer, Colour field, Now / next,
              Written round, Day rings, Hero + health, Morning, and Agenda.
              Steps and battery come from the watch. For sleep, choose a sleep
              app such as Samsung Health for the face's sleep slot in Customize.
            </p>
          </fieldset>
          <fieldset className="settings-fieldset" disabled={save.isPending}>
            <legend>Favorite activities</legend>
            <p>Favorites appear first in the watch activity picker.</p>
            {activities.data?.map((activity) => (
              <label className="notification-enabled" key={activity.id}>
                <input
                  type="checkbox"
                  checked={value.favorites.includes(activity.id)}
                  disabled={save.isPending}
                  onChange={(event) =>
                    update({
                      favorites: event.target.checked
                        ? [...value.favorites, activity.id].slice(0, 20)
                        : value.favorites.filter((id) => id !== activity.id),
                    })
                  }
                />
                {activity.name}
              </label>
            ))}
          </fieldset>
        </>
      )}
      <p role="status" className="settings-hint">
        {save.isPending ? "Saving..." : message}
      </p>
    </section>
  );
}
