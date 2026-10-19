import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../../../components/ui/button";
import { notesApi } from "../api";
import type { Note } from "../types";

interface NoteEditorProps {
  note: Note;
  onClose: () => void;
}

export function NoteEditor({ note, onClose }: NoteEditorProps) {
  const queryClient = useQueryClient();
  const [content, setContent] = useState(note.content);
  const update = useMutation({
    mutationFn: () => notesApi.update(note.id, content, note.content),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["notes", note.channel_id] });
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
      <textarea
        aria-label="Edit note"
        autoFocus
        value={content}
        onChange={(event) => setContent(event.target.value)}
        maxLength={40000}
        rows={Math.min(12, content.split("\n").length + 1)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            saveChanges();
          }
        }}
      />
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
        <Button type="submit" size="small" disabled={!content.trim() || update.isPending}>
          <Check size={13} />
          Save changes
        </Button>
      </div>
    </form>
  );
}
