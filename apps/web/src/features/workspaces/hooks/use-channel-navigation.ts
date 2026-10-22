import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";
import { toast } from "sonner";
import {
  prepareDestination,
  type ChannelDestination,
} from "../navigation-data";
import type { Channel } from "../types";

export function useChannelNavigation() {
  const client = useQueryClient();
  const location = useLocation();
  const sequence = useRef(0);
  const [pending, setPending] = useState<ChannelDestination | null>(null);
  const cancel = useCallback(() => {
    sequence.current += 1;
    setPending(null);
  }, []);
  useEffect(() => {
    cancel();
    return () => {
      sequence.current += 1;
    };
  }, [location.key, cancel]);

  async function open(
    target: ChannelDestination,
    commit: (channel?: Channel) => void,
  ) {
    const request = ++sequence.current;
    setPending(target);
    try {
      const channel = await prepareDestination(client, target);
      if (sequence.current === request) commit(channel);
    } catch (error) {
      if (sequence.current === request) {
        const cached = client
          .getQueryCache()
          .getAll()
          .some((query) => query.state.error === error);
        if (!cached)
          toast.error(
            error instanceof Error
              ? error.message
              : "Could not open this channel.",
          );
      }
    } finally {
      if (sequence.current === request) setPending(null);
    }
  }
  return { open, cancel, pending };
}
