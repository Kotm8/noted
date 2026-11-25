import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ConnectionScreen } from "./components/connection-screen";
import { authApi } from "./features/auth/api";
import { AuthScreen } from "./features/auth/components/auth-screen";
import { useSessionRenewal } from "./features/auth/hooks/use-session-renewal";
import { WorkspaceRoutes } from "./features/workspaces/workspace-routes";
import { lazy, Suspense, useEffect } from "react";
import { finishStartup } from "./lib/startup";
import { prepareStartup } from "./features/workspaces/navigation-data";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  androidPilot,
  getPilotOffline,
  isAndroidPilot,
  PilotOwnerContext,
  usePilotOffline,
} from "./lib/android-pilot";

const SetupPreview = import.meta.env.DEV
  ? lazy(() =>
      import("./features/installer/setup-preview").then((module) => ({
        default: module.SetupPreview,
      })),
    )
  : null;

export function App() {
  useEffect(() => {
    if (window.location.pathname === "/setup-preview") finishStartup();
  }, []);
  if (SetupPreview && window.location.pathname === "/setup-preview") {
    return (
      <Suspense fallback={<ConnectionScreen />}>
        <SetupPreview />
      </Suspense>
    );
  }
  return <ConnectedApp />;
}

function ConnectedApp() {
  const client = useQueryClient();
  const offline = usePilotOffline();
  const navigate = useNavigate();
  useEffect(() => {
    if (!isAndroidPilot) return;
    let active = true;
    const listener = androidPilot.addListener(
      "notificationOpen",
      ({ path }) => {
        if (active) void navigate(path);
      },
    );
    const captureProblem = androidPilot.addListener(
      "captureProblem",
      ({ message }) => {
        if (active) toast.error(message);
      },
    );
    void listener.catch(() => {});
    void captureProblem.catch(() => {});
    return () => {
      active = false;
      void listener.then((handle) => handle.remove()).catch(() => {});
      void captureProblem.then((handle) => handle.remove()).catch(() => {});
    };
  }, [navigate]);
  const session = useQuery({
    queryKey: ["session"],
    queryFn: authApi.getSession,
  });
  useSessionRenewal(session.data?.id);
  const refetchSession = session.refetch;
  useEffect(() => {
    if (!offline) return;
    function revalidate() {
      if (document.visibilityState === "visible")
        void refetchSession({ cancelRefetch: false });
    }
    const timer = window.setInterval(revalidate, 15000);
    window.addEventListener("online", revalidate);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", revalidate);
    };
  }, [offline, refetchSession]);
  useEffect(() => {
    if (session.data !== null) return;
    const filter = {
      predicate: (query: { queryKey: readonly unknown[] }) =>
        !["session", "auth-status"].includes(String(query.queryKey[0])),
    };
    void client.cancelQueries(filter);
    client.removeQueries(filter);
  }, [client, session.data]);
  const setupStatus = useQuery({
    queryKey: ["auth-status"],
    queryFn: authApi.getSetupStatus,
    enabled: session.data === null,
  });
  const startup = useQuery({
    queryKey: ["startup-data", session.data?.id],
    enabled: Boolean(session.data),
    staleTime: Infinity,
    queryFn: async () => {
      try {
        await prepareStartup(client, new URL(window.location.href));
      } catch (error) {
        if (!getPilotOffline()) throw error;
      }
      return true;
    },
  });

  function retryConnection() {
    void session.refetch();
    if (session.data === null) void setupStatus.refetch();
    if (startup.isError) void startup.refetch();
  }

  const error = session.error ?? setupStatus.error ?? startup.error;
  const checkingSetup = session.data === null && setupStatus.isPending;
  const pending =
    session.isPending ||
    checkingSetup ||
    (Boolean(session.data) && startup.isPending);
  useEffect(() => {
    if (error || (!pending && !session.data)) finishStartup();
  }, [error, pending, session.data]);
  if (error)
    return <ConnectionScreen error={error.message} onRetry={retryConnection} />;

  if (pending) return <ConnectionScreen />;

  if (!session.data) {
    return <AuthScreen setup={setupStatus.data?.setup_required ?? false} />;
  }

  return (
    <PilotOwnerContext.Provider
      key={session.data.id}
      value={isAndroidPilot ? session.data.id : null}
    >
      <WorkspaceRoutes />
    </PilotOwnerContext.Provider>
  );
}
