import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isDesktop } from "../connection-context";
import { desktopRequest } from "../desktop-request";

export interface DesktopStartup {
  enabled: boolean;
  minimized: boolean;
  asked: boolean;
}

const key = ["desktop-startup"];

export function useDesktopStartup() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: key,
    queryFn: () => desktopRequest<DesktopStartup>("startup"),
    enabled: isDesktop,
    retry: false,
  });
  const change = useMutation({
    scope: { id: "desktop-startup" },
    mutationFn: (value: Partial<DesktopStartup>) =>
      desktopRequest<DesktopStartup>("startup", "PUT", value),
    onSuccess: (value) => client.setQueryData(key, value),
  });
  return { query, change };
}
