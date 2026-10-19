import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Settings2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../../components/ui/button";
import { Notice } from "../../components/ui/notice";
import { request } from "../../lib/http";
import { AndroidNotificationsStep } from "../installer/components/android-notifications-step";
import { firebaseError } from "../installer/firebase";
import {
  initialInstallation,
  type UpdateInstallation,
} from "../installer/types";
import type { AndroidPushStatus } from "./android";
import "../../styles/installer.css";

export function AndroidServerSetup({
  status,
}: {
  status: AndroidPushStatus | undefined;
}) {
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    ...initialInstallation,
    androidNotifications: true,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const update: UpdateInstallation = (key, value) => {
    setError(null);
    setDraft((current) => ({ ...current, [key]: value }));
  };

  async function save() {
    const error = firebaseError(draft);
    if (error) {
      setError(error);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const saved = await request<AndroidPushStatus>(
        "/notifications/android/config",
        "PUT",
        {
          googleServicesJson: draft.googleServicesJson,
          serviceAccountJson: draft.serviceAccountJson,
        },
      );
      setDraft({ ...initialInstallation, androidNotifications: true });
      setEditing(false);
      client.setQueryData(["android-server-configuration"], saved);
      await client.invalidateQueries({ queryKey: ["device-push-state"] });
      toast.success(
        "Firebase configured. Enable notifications in the Android app to connect your phone.",
      );
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not save Firebase configuration.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (status?.configured && !editing)
    return (
      <div className="android-project-status">
        <span>
          <Check size={16} />
          <span>
            Firebase connected<strong>{status.project_id}</strong>
          </span>
        </span>
        <Button variant="ghost" size="small" onClick={() => setEditing(true)}>
          <Settings2 size={14} /> Change project
        </Button>
      </div>
    );

  return (
    <div className="android-server-setup">
      <fieldset className="installation-fields" disabled={busy || !status}>
        <AndroidNotificationsStep
          draft={draft}
          update={update}
          optional={false}
        />
        {error && <Notice tone="error">{error}</Notice>}
        {draft.androidNotifications && (
          <Button
            type="button"
            disabled={busy}
            onClick={() => {
              void save();
            }}
          >
            {busy ? "Saving..." : "Save Firebase configuration"}
          </Button>
        )}
        {status?.configured && (
          <Button
            variant="ghost"
            type="button"
            onClick={() => {
              setEditing(false);
              setDraft({ ...initialInstallation, androidNotifications: true });
              setError(null);
            }}
          >
            <X size={14} /> Cancel changes
          </Button>
        )}
      </fieldset>
    </div>
  );
}
