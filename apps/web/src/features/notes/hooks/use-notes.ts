import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { notesApi } from "../api";
import { enqueue, flushOutbox } from "../outbox";
import { notesQuery } from "../queries";
import type { ReminderSchedule } from "../../reminders/types";

export function useNotes(channelId: string, targetId?: string) {
  const queryClient = useQueryClient();
  const query = useInfiniteQuery(notesQuery(channelId, targetId));

  const createNote = useMutation({
    // Offline sends still run, so the message can wait in the outbox instead of the queue
    // of paused mutations, which a closed tab would lose.
    networkMode: "always",
    mutationFn: async ({
      content,
      files,
      reminder,
    }: {
      content: string;
      files: File[];
      reminder?: ReminderSchedule;
    }) => {
      await enqueue(
        { clientId: crypto.randomUUID(), channelId, content, reminder },
        files,
      );
      void flushOutbox(queryClient);
    },
    onError: (error) => toast.error(error.message),
  });

  const deleteNote = useMutation({
    mutationFn: (id: string) => notesApi.remove(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["notes", channelId] });
      await queryClient.invalidateQueries({ queryKey: ["search"] });
      toast.success("Note deleted");
    },
    onError: (error) => toast.error(error.message),
  });

  const notes =
    query.data?.pages
      .slice()
      .reverse()
      .flatMap((page) => page.items) ?? [];

  return { query, notes, createNote, deleteNote };
}
