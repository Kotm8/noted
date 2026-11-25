import { useState, type ReactNode } from "react";
import {
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { Toaster, toast } from "sonner";
import { AndroidTransferProgress } from "../components/android-transfer-progress";
import { ApiError } from "../lib/http";
import { getPilotOffline, isAndroidPilot } from "../lib/android-pilot";
import { AppearanceProvider } from "../features/settings/appearance-provider";
import { DesktopUpdateNotice } from "../features/desktop/updates/desktop-update-notice";

function createQueryClient(): QueryClient {
  const queryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (
          error instanceof ApiError &&
          error.status === 401 &&
          query.queryKey[0] !== "session" &&
          queryClient.getQueryData(["session"])
        ) {
          void queryClient.invalidateQueries(
            { queryKey: ["session"], exact: true },
            { cancelRefetch: false },
          );
          return;
        }
        if (
          !(
            getPilotOffline() &&
            error instanceof ApiError &&
            error.status === 503
          )
        )
          toast.error(error.message);
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 30000,
        retry: false,
        networkMode: isAndroidPilot ? "always" : "online",
        refetchOnWindowFocus: true,
      },
      mutations: { networkMode: isAndroidPilot ? "always" : "online" },
    },
  });

  return queryClient;
}

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <AppearanceProvider>
        <BrowserRouter>
          {children}
          <DesktopUpdateNotice />
        </BrowserRouter>
        <AndroidTransferProgress />
        <Toaster
          theme="dark"
          position="top-right"
          duration={2000}
          toastOptions={{
            style: {
              background: "var(--surface-floating)",
              color: "var(--text-primary)",
              border: "1px solid var(--border-default)",
              borderRadius: "6px",
            },
          }}
        />
      </AppearanceProvider>
    </QueryClientProvider>
  );
}
