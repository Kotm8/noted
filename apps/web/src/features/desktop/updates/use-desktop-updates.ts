import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isDesktop } from "../connection-context";
import { desktopRequest } from "../desktop-request";

export interface DesktopUpdateStatus {
  supported: boolean;
  current_version: string;
  latest_version: string | null;
  notes: string | null;
  checked_at: number | null;
  phase:
    | "idle"
    | "checking"
    | "available"
    | "downloading"
    | "ready"
    | "installing"
    | "error";
  downloaded_bytes: number;
  total_bytes: number | null;
  error: string | null;
}

const key = ["desktop-client-updates"];

export function useDesktopUpdates() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: key,
    queryFn: () => desktopRequest<DesktopUpdateStatus>("updates"),
    enabled: isDesktop,
    refetchInterval: (query) =>
      ["checking", "downloading", "installing"].includes(
        query.state.data?.phase ?? "",
      )
        ? 500
        : 30000,
    retry: false,
  });
  const action = useMutation({
    mutationFn: (action: "check" | "download" | "install") =>
      desktopRequest<DesktopUpdateStatus>("updates", "POST", {
        action,
        version: query.data?.latest_version,
      }),
    onSuccess: (status) => client.setQueryData(key, status),
  });
  return { query, action };
}
