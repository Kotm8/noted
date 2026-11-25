import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../../../lib/http";
import { getPilotOffline } from "../../../lib/android-pilot";
import { authApi } from "../api";

export function useSessionRenewal(userId: string | undefined) {
  const client = useQueryClient();
  const renewal = useRef({ userId, next: 0, pending: false });
  useEffect(() => {
    if (renewal.current.userId !== userId)
      renewal.current = { userId, next: 0, pending: false };
    if (!userId) return;
    const current = renewal.current;
    function renew(event?: Event) {
      if (
        (event && !event.isTrusted) ||
        current.pending ||
        getPilotOffline() ||
        document.visibilityState !== "visible" ||
        Date.now() < current.next
      )
        return;
      current.pending = true;
      current.next = Date.now() + 15 * 60 * 1000;
      void authApi
        .renew()
        .catch((error: unknown) => {
          if (renewal.current !== current) return;
          if (error instanceof ApiError && error.status === 404) return;
          current.next = Date.now() + 60 * 1000;
          if (error instanceof ApiError && error.status === 401)
            void client.invalidateQueries(
              { queryKey: ["session"], exact: true },
              { cancelRefetch: false },
            );
        })
        .finally(() => {
          current.pending = false;
        });
    }
    renew();
    window.addEventListener("pointerdown", renew, { passive: true });
    window.addEventListener("keydown", renew);
    return () => {
      window.removeEventListener("pointerdown", renew);
      window.removeEventListener("keydown", renew);
    };
  }, [client, userId]);
}
