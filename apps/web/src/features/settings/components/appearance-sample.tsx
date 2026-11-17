import { Hash, Plus, Send } from "lucide-react";
import { ComicHalftone } from "../../../components/ui/comic-halftone";
import { messageLayouts } from "../appearance";
import { useAppearance } from "../appearance-context";

const notes = [
  { minute: 823, text: "A few things to come back to." },
  { minute: 823, text: "Keep the afternoon free for reading." },
  { minute: 824, text: "Finish the chapter", task: true },
  { minute: 830, text: "A thought after a short break." },
  { minute: 830, text: "And one more thing to remember." },
];
const time = (minute: number) =>
  `${Math.floor(minute / 60)}:${String(minute % 60).padStart(2, "0")}`;

export function AppearanceSample() {
  const { preferences: p } = useAppearance();
  const groups: (typeof notes)[] = [];
  for (const note of notes) {
    const previous = groups.at(-1)?.at(-1);
    if (!previous || note.minute - previous.minute > p.messageGroupMinutes)
      groups.push([]);
    groups.at(-1)!.push(note);
  }
  return (
    <aside className="appearance-sample-wrap" aria-label="Message preview">
      <div className="appearance-sample-heading">
        <span>MESSAGE PREVIEW</span>
        <span>{messageLayouts[p.messageLayout].label}</span>
      </div>
      <div className="appearance-sample">
        <header>
          <ComicHalftone />
          <Hash size={17} />
          little-thoughts
        </header>
        <div className="appearance-sample-body" data-layout={p.messageLayout}>
          {groups.map((group) => (
            <div className="appearance-message-group" key={group[0].minute}>
              {!["quiet", "rows"].includes(p.messageLayout) && (
                <time className="appearance-marker">
                  {time(group[0].minute)}
                </time>
              )}
              {group.map((note, index) => (
                <div
                  className={`appearance-note ${index ? "appearance-follow" : ""}`}
                  key={`${note.minute}-${index}`}
                  tabIndex={0}
                >
                  <time className="appearance-note-time">
                    {time(note.minute)}
                  </time>
                  {note.task ? (
                    <label className="appearance-task">
                      <input type="checkbox" />
                      {note.text}
                    </label>
                  ) : (
                    <p>{note.text}</p>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="appearance-sample-composer">
          <Plus size={17} />
          <span>Message #little-thoughts</span>
          <Send size={16} />
        </div>
      </div>
      <p className="settings-hint">
        {messageLayouts[p.messageLayout].description}
      </p>
    </aside>
  );
}
