import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LoaderCircle, Monitor, RefreshCw, Smartphone } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Notice } from "../../../components/ui/notice";
import { authApi } from "../../auth/api";
import { useLogout } from "../../auth/hooks/use-logout";
import { describeDevice } from "../session-device";

function SessionTime({ value }: { value: string | null }) {
  if (!value) return <>Unavailable</>;
  return <time dateTime={value}>{new Date(value).toLocaleString()}</time>;
}

export function SessionsPanel() {
  const client = useQueryClient();
  const logout = useLogout();
  const sessions = useQuery({
    queryKey: ["login-sessions"],
    queryFn: authApi.listSessions,
    refetchInterval: 30000,
  });
  const revoke = useMutation({
    mutationFn: authApi.revokeSession,
    onSuccess: () => client.invalidateQueries({ queryKey: ["login-sessions"] }),
  });

  return (
    <section className="settings-panel sessions-panel">
      <div className="sessions-heading">
        <h2>Active sessions</h2>
        <Button
          variant="ghost"
          size="small"
          disabled={sessions.isFetching}
          onClick={() => void sessions.refetch()}
        >
          <RefreshCw size={14} />
          Refresh
        </Button>
      </div>
      <p>Devices signed in to this server. Sign out any session individually.</p>
      {sessions.isPending && <Notice>Loading sessions...</Notice>}
      {sessions.isError && <Notice tone="error">{sessions.error.message}</Notice>}
      {revoke.isError && <Notice tone="error">{revoke.error.message}</Notice>}
      <div className="sessions-list">
        {sessions.data?.map((session) => {
          const device = describeDevice(session.user_agent);
          const DeviceIcon = device.mobile ? Smartphone : Monitor;
          const label = `${device.browser}${device.platform ? ` on ${device.platform}` : ""}`;
          const signingOut = (revoke.isPending && revoke.variables === session.id)
            || (session.is_current && logout.isPending);
          return (
            <article className="session-row" key={session.id}>
              <DeviceIcon size={20} className="session-device-icon" />
              <div className="session-details">
                <div className="session-name">
                  <h3>{label}</h3>
                  {session.is_current && <span className="session-current">This device</span>}
                </div>
                <p>Last active <SessionTime value={session.last_seen_at} /></p>
                <p>Signed in <SessionTime value={session.created_at} /></p>
                <p>Expires <SessionTime value={session.expires_at} /></p>
              </div>
              <Button
                variant="secondary"
                size="small"
                aria-label={session.is_current ? "Sign out this device" : `Sign out ${label}`}
                disabled={revoke.isPending || logout.isPending}
                onClick={() => session.is_current ? logout.mutate() : revoke.mutate(session.id)}
              >
                {signingOut
                  ? <LoaderCircle size={14} className="animate-spin" /> : "Sign out"}
              </Button>
            </article>
          );
        })}
      </div>
      <p className="settings-hint">
        Each browser or app sign-in is a separate session. Activity updates at most every five
        minutes. Older sessions may have no device information.
      </p>
    </section>
  );
}
