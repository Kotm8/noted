import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { notesApi } from "../api";
import type { Note } from "../types";
import { Markdown } from "./markdown";

export function MessageMarkdown({ note }: { note: Note }) {
  const client = useQueryClient();
  const [optimistic, setOptimistic] = useState<{
    source: string;
    content: string;
  } | null>(null);
  const update = useMutation({
    mutationFn: (content: string) =>
      notesApi.update(note.id, content, note.content),
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: ["notes", note.channel_id] }),
        client.invalidateQueries({ queryKey: ["thread"] }),
        client.invalidateQueries({ queryKey: ["search"] }),
      ]),
    onError: (error) => {
      setOptimistic(null);
      toast.error(error.message);
      void client.invalidateQueries({ queryKey: ["notes", note.channel_id] });
      void client.invalidateQueries({ queryKey: ["thread"] });
    },
    onSettled: () => setOptimistic(null),
  });
  return (
    <Markdown
      content={
        optimistic?.source === note.content ? optimistic.content : note.content
      }
      pending={update.isPending}
      onContentChange={(content) => {
        setOptimistic({ source: note.content, content });
        update.mutate(content);
      }}
    />
  );
}
