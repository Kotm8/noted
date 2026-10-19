import { useMutation, useQueryClient } from "@tanstack/react-query";
import { authApi } from "../api";
import type { Credentials } from "../types";
import { isDesktop } from "../../desktop/connection-context";
import { desktopRequest } from "../../desktop/desktop-request";

export function useAuthentication() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      remember,
      ...credentials
    }: Credentials & { remember?: boolean }) => {
      if (isDesktop)
        await desktopRequest("session", "PUT", { remember: remember ?? false });
      return authApi.login(credentials);
    },
    onSuccess: (user) => {
      queryClient.setQueryData(["session"], user);
      void queryClient.invalidateQueries({ queryKey: ["auth-status"] });
    },
  });
}
