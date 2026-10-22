import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { notesApi } from "../api";
import { notesQuery } from "../queries";
import type { ReminderSchedule } from "../../reminders/types";

export function useNotes(channelId: string, targetId?: string) {
  const queryClient = useQueryClient();
  const query = useInfiniteQuery(notesQuery(channelId, targetId));

  const createNote = useMutation({
    mutationFn: ({
      content,
      files,
      reminder,
    }: {
      content: string;
      files: File[];
      reminder?: ReminderSchedule;
    }) =>
      files.length
        ? notesApi.createWithFiles(channelId, content, files, reminder)
        : notesApi.create(channelId, content, reminder),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["notes", channelId] }),
        queryClient.invalidateQueries({ queryKey: ["search"] }),
        queryClient.invalidateQueries({ queryKey: ["publishing"] }),
        queryClient.invalidateQueries({ queryKey: ["home-activity"] }),
      ]),
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
