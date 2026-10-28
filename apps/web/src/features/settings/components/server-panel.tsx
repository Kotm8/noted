import { Notice } from "../../../components/ui/notice";
import { useQuery } from "@tanstack/react-query";
import { Button } from "../../../components/ui/button";
import { settingsApi } from "../api";
import { PasswordForm } from "./password-form";
import { SessionsPanel } from "./sessions-panel";
import { UpdatesPanel } from "../../updates/components/updates-panel";
import { HostPanel } from "../../host/components/host-panel";
import { ServerAddressPanel } from "../../desktop/server-address-panel";

export function ServerPanel() {
  const query = useQuery({
    queryKey: ["server-settings"],
    queryFn: settingsApi.getServer,
  });

  if (query.isPending)
    return (
      <section className="settings-panel">
        <h2>Server</h2>
        <p role="status">Loading instance details...</p>
      </section>
    );
  if (query.isError)
    return (
      <section className="settings-panel">
        <h2>Server</h2>
        <Notice tone="error">{query.error.message}</Notice>
        <Button onClick={() => void query.refetch()}>Retry</Button>
      </section>
    );

  return (
    <section className="settings-panel">
      <h2>Server</h2>
      <dl className="server-details">
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
          <dt>Version</dt>
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
      <UpdatesPanel />
      <PasswordForm />
      <SessionsPanel />
      <HostPanel
        ownerUsername={query.data.owner_username}
        instance={query.data.instance_url}
      />
      <ServerAddressPanel />
    </section>
  );
}
