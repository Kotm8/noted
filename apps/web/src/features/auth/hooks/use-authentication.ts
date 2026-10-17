import { useMutation, useQueryClient } from "@tanstack/react-query";
import { authApi } from "../api";
import type { Credentials } from "../types";

export function useAuthentication() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (credentials: Credentials) => authApi.login(credentials),
    onSuccess: (user) => {
      queryClient.setQueryData(["session"], user);
      void queryClient.invalidateQueries({ queryKey: ["auth-status"] });
    },
  });
}
