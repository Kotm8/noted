import { Notice } from "../../../components/ui/notice";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "../../../components/ui/button";
import { androidPilot, isAndroidPilot } from "../../../lib/android-pilot";
import { settingsApi } from "../api";
import { PasswordForm } from "./password-form";
import { SessionsPanel } from "./sessions-panel";
import { UpdatesPanel } from "../../updates/components/updates-panel";
import { HostPanel } from "../../host/components/host-panel";
import { ServerAddressPanel } from "../../desktop/server-address-panel";
import { SwitchServerButton } from "../../desktop/switch-server-button";
import { isAndroidApp } from "../../notifications/android";
import { version as clientVersion } from "../../../../package.json";

export function ServerPanel() {
  return (
    <section className="settings-panel">
      <h2>Server</h2>
      {isAndroidApp() && <SwitchServerButton />}
      <ServerContent />
      {isAndroidPilot && <LegacyWork />}
    </section>
  );
}

function LegacyWork() {
  const work = useQuery({
    queryKey: ["android-unsent-recovery"],
    queryFn: () => androidPilot.legacyWorkAvailable(),
  });
  const save = useMutation({
    mutationFn: () => androidPilot.exportLegacyWork(),
    onSuccess: ({ saved }) => {
      if (saved) toast.success("Unsent work exported.");
    },
  });
  if (!work.data?.available) return null;
  return (
    <div className="settings-section">
      <h3>Recover unsent work</h3>
      <p>
        Save drafts and queued messages from your earlier Android app to a file
        so you can copy them into Noted.
      </p>
      {save.error && <Notice tone="error">{save.error.message}</Notice>}
      <Button
        disabled={save.isPending}
        variant="secondary"
        onClick={() => save.mutate()}
      >
        {save.isPending ? "Saving..." : "Export unsent work"}
      </Button>
    </div>
  );
}

function ServerContent() {
  const query = useQuery({
    queryKey: ["server-settings"],
    queryFn: settingsApi.getServer,
    staleTime: 0,
    refetchOnMount: "always",
  });

  if (query.isPending) return <p role="status">Loading instance details...</p>;
  if (query.isError)
    return (
      <>
        <Notice tone="error">{query.error.message}</Notice>
        <Button onClick={() => void query.refetch()}>Retry</Button>
      </>
    );

  return (
    <>
      <dl className="server-details">
        <div>
          <dt>Client version</dt>
          <dd>{clientVersion}</dd>
        </div>
        <div>
          <dt>Name</dt>
          <dd>{query.data.server_name}</dd>
        </div>
        <div>
          <dt>Instance</dt>
          <dd>{query.data.instance_url}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{query.data.database_ready ? "Ready" : "Needs attention"}</dd>
        </div>
        <div>
          <dt>Server version</dt>
          <dd>{query.data.version}</dd>
        </div>
        <div>
          <dt>Owner</dt>
          <dd>{query.data.owner_username}</dd>
        </div>
        <div>
          <dt>Access</dt>
          <dd>Private, owner only</dd>
        </div>
      </dl>
      <p className="settings-hint">
        Additional accounts and invitations are planned for a later version.
      </p>
      {isAndroidPilot ? (
        <div className="settings-section">
          <h3>Server maintenance</h3>
          <p>
            Use Noted on desktop to install server updates or manage hosting.
          </p>
        </div>
      ) : (
        <UpdatesPanel />
      )}
      <PasswordForm />
      <SessionsPanel />
      {!isAndroidPilot && (
        <HostPanel
          ownerUsername={query.data.owner_username}
          instance={query.data.instance_url}
        />
      )}
      <ServerAddressPanel />
    </>
  );
}
