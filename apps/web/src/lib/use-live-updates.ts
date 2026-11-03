import { useEffect, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  LiveConnection,
  liveConnected,
  liveInterval,
  subscribeLive,
} from "./live";

export function useLiveUpdates() {
  const client = useQueryClient();
  useEffect(() => {
    const connection = new LiveConnection(client);
    const start = setTimeout(() => connection.start(), 0);
    return () => {
      clearTimeout(start);
      connection.stop();
    };
  }, [client]);
}

export function useLiveInterval(fallback: number) {
  const connected = useSyncExternalStore(subscribeLive, liveConnected);
  return liveInterval(fallback, connected);
}
