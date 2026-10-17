import type { Channel } from "../../workspaces/types";

interface ChannelIntroProps {
  channel: Channel;
  isEmpty: boolean;
}

export function ChannelIntro({ channel, isEmpty }: ChannelIntroProps) {
  if (!isEmpty) return null;

  return (
    <div className="channel-intro">
      <h2>No notes yet</h2>
      <p>Write the first note in #{channel.name}. You can use Markdown, links, and code.</p>
    </div>
  );
}
