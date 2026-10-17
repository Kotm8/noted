import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { authApi } from "../api";

export function useLogout() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  return useMutation({
    mutationFn: authApi.logout,
    onSuccess: async () => {
      await queryClient.cancelQueries();
      queryClient.setQueryData(["session"], null);
      await queryClient.invalidateQueries({ queryKey: ["auth-status"] });
      queryClient.removeQueries({
        predicate: (query) => !["session", "auth-status"].includes(String(query.queryKey[0])),
      });
      navigate("/", { replace: true });
    },
    onError: (error) => toast.error(error.message),
  });
}
