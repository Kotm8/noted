import { useLayoutEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../../../components/ui/button";
import { notesApi } from "../api";
import type { Note } from "../types";
import { useMentionDirectory } from "../mention-context";
import { chatEnter } from "../chat-enter";
import { toEditable, toStored } from "../mentions";
import { useMentionPicker } from "./mention-picker";
import {
  useFormatting,
  useFormattingVisible,
} from "../../writing/use-formatting";

interface NoteEditorProps {
  note: Note;
  onClose: () => void;
}

export function NoteEditor({ note, onClose }: NoteEditorProps) {
  const queryClient = useQueryClient();
  const { channels } = useMentionDirectory();
  const [editable] = useState(() => toEditable(note.content, channels));
  const [content, setContent] = useState(editable.text);
  const placed = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const mentions = useMentionPicker(inputRef, content, editable.refs);
  const formatting = useFormatting(inputRef);
  const [formattingVisible] = useFormattingVisible();
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = "auto";
    const border = input.offsetHeight - input.clientHeight;
    input.style.height = `${Math.min(input.scrollHeight + border, 360)}px`;
  }, [content]);
  const update = useMutation({
    mutationFn: () =>
      notesApi.update(
        note.id,
        toStored(content, mentions.refs.current),
        note.content,
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["notes", note.channel_id],
      });
      await queryClient.invalidateQueries({ queryKey: ["search"] });
      await queryClient.invalidateQueries({ queryKey: ["thread"] });
      onClose();
    },
    onError: (error) => toast.error(error.message),
  });

  function saveChanges() {
    if (content.trim() && !update.isPending) update.mutate();
  }

  return (
    <form
      className="edit-form"
      onSubmit={(event) => {
        event.preventDefault();
        saveChanges();
      }}
    >
      {mentions.menu}
      {formattingVisible && formatting.toolbar}
      <textarea
        ref={inputRef}
        aria-label="Edit note"
        autoFocus
        onFocus={(event) => {
          // Opening the editor starts at the end of the text, ready to add to it.
          if (placed.current) return;
          placed.current = true;
          const end = event.currentTarget.value.length;
          event.currentTarget.setSelectionRange(end, end);
        }}
        value={content}
        onChange={(event) => setContent(event.target.value)}
        onSelect={mentions.onSelect}
        maxLength={40000}
        rows={1}
        onKeyDown={(event) => {
          if (mentions.onKeyDown(event) || formatting.onKeyDown(event)) return;
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
          chatEnter(event, saveChanges);
        }}
      />
      {formatting.dialog}
      <div className="edit-actions">
        <Button
          type="button"
          variant="ghost"
          size="small"
          onClick={onClose}
          disabled={update.isPending}
        >
          <X size={13} />
          Cancel
        </Button>
        <Button
          type="submit"
          size="small"
          disabled={!content.trim() || update.isPending}
        >
          <Check size={13} />
          Save changes
        </Button>
      </div>
    </form>
  );
}
