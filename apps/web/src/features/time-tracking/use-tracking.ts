import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { trackingApi } from "./api";
import type { TrackerAction } from "./types";

export function useTracking() {
  const client = useQueryClient();
  const tracker = useQuery({
    queryKey: ["time-tracker"],
    queryFn: trackingApi.tracker,
    refetchInterval: 5000,
    refetchOnWindowFocus: "always",
  });
  const activities = useQuery({
    queryKey: ["activities"],
    queryFn: trackingApi.activities,
    refetchInterval: 15000,
  });
  const action = useMutation({
    mutationFn: ({
      action,
      activityId,
    }: {
      action: TrackerAction;
      activityId?: string;
    }) => {
      if (!tracker.data) throw new Error("Wait for the tracker to connect.");
      return trackingApi.act(action, tracker.data.revision, activityId);
    },
    onSuccess: (data) => {
      client.setQueryData(["time-tracker"], data);
      void client.invalidateQueries({ queryKey: ["schedule"] });
    },
    onError: (error) => {
      toast.error(error.message);
      void client.invalidateQueries({ queryKey: ["time-tracker"] });
    },
  });
  return { tracker, activities, action };
}
