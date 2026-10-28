import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ConnectionScreen } from "./components/connection-screen";
import { authApi } from "./features/auth/api";
import { AuthScreen } from "./features/auth/components/auth-screen";
import { WorkspaceRoutes } from "./features/workspaces/workspace-routes";
import { lazy, Suspense, useEffect } from "react";
import { finishStartup } from "./lib/startup";
import { prepareStartup } from "./features/workspaces/navigation-data";

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
  const session = useQuery({
    queryKey: ["session"],
    queryFn: authApi.getSession,
  });
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
      await prepareStartup(client, new URL(window.location.href));
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

  return <WorkspaceRoutes />;
}
