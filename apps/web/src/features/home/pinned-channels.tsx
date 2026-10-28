import { useQuery } from "@tanstack/react-query";
import { workspaceApi } from "../workspaces/api";
import { ChannelIcon } from "../workspaces/components/channel-icon";
import { useAllChannels } from "../workspaces/hooks/use-all-channels";
import type { Channel } from "../workspaces/types";

export function PinnedChannels({
  onOpen,
}: {
  onOpen: (channel: Channel) => void;
}) {
  const channels = useAllChannels();
  const workspaces = useQuery({
    queryKey: ["workspaces"],
    queryFn: workspaceApi.list,
  }).data;
  const pinned = (channels ?? [])
    .filter((channel) => channel.pinned_at)
    .sort((a, b) => a.pinned_at!.localeCompare(b.pinned_at!));
  if (!pinned.length) return null;

  return (
    <section className="home-pinned" aria-label="Pinned channels">
      <div className="home-section-heading">
        <h2>Pinned</h2>
      </div>
      <ul>
        {pinned.map((channel) => (
          <li key={channel.id}>
            <button onClick={() => onOpen(channel)}>
              <ChannelIcon kind={channel.kind} size={15} />
              <span>{channel.name}</span>
              <small>
                {workspaces?.find((item) => item.id === channel.workspace_id)
                  ?.name ?? ""}
              </small>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
