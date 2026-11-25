import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { request } from "../../lib/http";
import { liveInterval } from "../../lib/live";
import { isAndroidPilot } from "../../lib/android-pilot";
import { shrinkImage } from "../../lib/shrink-image";
import type { FinanceAction, FinanceBoard } from "./types";

export const financeApi = {
  board: (month?: string, search = "", offset = 0) => {
    const params = new URLSearchParams({ search, offset: String(offset) });
    if (month) params.set("month", month);
    return request<FinanceBoard>(`/finance?${params}`);
  },
  action: (action: FinanceAction) =>
    request<{ id: string; revision: number }>("/finance/actions", "POST", {
      ...action,
      request_id: action.request_id ?? crypto.randomUUID(),
    }),
  photo: async (file: File) => {
    const body = new FormData();
    body.append("file", isAndroidPilot ? await shrinkImage(file) : file);
    return request<{ id: string }>("/finance/photos", "POST", body);
  },
};
export const photoUrl = (id: string) => `/api/v1/finance/photos/${id}`;

export function useFinance(month?: string, search = "", offset = 0) {
  return useQuery({
    queryKey: ["finance", "board", month ?? "current", search, offset],
    queryFn: () => financeApi.board(month, search, offset),
    refetchInterval: () => liveInterval(60000),
  });
}

export function useFinanceAction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: financeApi.action,
    retry: false,
    onSuccess: () => client.invalidateQueries({ queryKey: ["finance"] }),
    onError: (error) => toast.error(error.message),
  });
}
