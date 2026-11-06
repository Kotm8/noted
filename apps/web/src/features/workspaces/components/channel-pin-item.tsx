import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pin, PinOff } from "lucide-react";
import { toast } from "sonner";
import { MenuItem } from "../../../components/ui/menu";
import { channelApi } from "../api";
import type { Channel } from "../types";

export function ChannelPinItem({ channel }: { channel: Channel }) {
  const client = useQueryClient();
  const pin = useMutation({
    mutationFn: (pinned: boolean) => channelApi.setPinned(channel.id, pinned),
    onSuccess: (updated) => {
      client.setQueriesData<Channel[]>({ queryKey: ["channels"] }, (channels) =>
        channels?.map((item) => (item.id === updated.id ? updated : item)),
      );
      toast.success(updated.pinned_at ? "Pinned to the sidebar" : "Unpinned");
      return client.invalidateQueries({ queryKey: ["channels"] });
    },
    onError: (error) => toast.error(error.message),
  });
  return (
    <MenuItem
      disabled={pin.isPending}
      onSelect={() => pin.mutate(!channel.pinned_at)}
    >
      {channel.pinned_at ? <PinOff size={14} /> : <Pin size={14} />}
      {channel.pinned_at ? "Unpin from Home" : "Pin to Home"}
    </MenuItem>
  );
}
