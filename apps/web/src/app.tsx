import { useQuery } from "@tanstack/react-query";
import { ConnectionScreen } from "./components/connection-screen";
import { authApi } from "./features/auth/api";
import { AuthScreen } from "./features/auth/components/auth-screen";
import { WorkspacePage } from "./features/workspaces/workspace-page";
import { lazy, Suspense, useEffect } from "react";
import { finishStartup } from "./lib/startup";

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
  const session = useQuery({
    queryKey: ["session"],
    queryFn: authApi.getSession,
  });
  const setupStatus = useQuery({
    queryKey: ["auth-status"],
    queryFn: authApi.getSetupStatus,
    enabled: session.data === null,
  });

  function retryConnection() {
    void session.refetch();
    if (session.data === null) void setupStatus.refetch();
  }

  const error = session.error ?? setupStatus.error;
  const checkingSetup = session.data === null && setupStatus.isPending;
  const pending = session.isPending || checkingSetup;
  useEffect(() => {
    if (error || !pending) finishStartup();
  }, [error, pending]);
  if (error)
    return <ConnectionScreen error={error.message} onRetry={retryConnection} />;

  if (pending) return <ConnectionScreen />;

  if (!session.data) {
    return <AuthScreen setup={setupStatus.data?.setup_required ?? false} />;
  }

  return <WorkspacePage />;
}
