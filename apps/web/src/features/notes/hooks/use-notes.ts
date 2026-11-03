import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { notesApi } from "../api";
import { enqueue, flushOutbox, hasWaiting, unreachable } from "../outbox";
import { notesQuery } from "../queries";
import type { ReminderSchedule } from "../../reminders/types";

export function useNotes(channelId: string, targetId?: string) {
  const queryClient = useQueryClient();
  const query = useInfiniteQuery(notesQuery(channelId, targetId));

  const createNote = useMutation({
    // Offline sends still run, so the message can wait in the outbox instead of the queue
    // of paused mutations, which a closed tab would lose.
    networkMode: "always",
    mutationFn: ({
      content,
      files,
      reminder,
    }: {
      content: string;
      files: File[];
      reminder?: ReminderSchedule;
    }) => {
      // Messages wait on this device when the server can't be reached, and go out in order.
      const clientId = crypto.randomUUID();
      const queue = async () => {
        await enqueue({ clientId, channelId, content, reminder }, files).catch(
          () => {
            throw new Error(
              "No connection, and the files couldn't be kept on this device. Your message is still in the composer.",
            );
          },
        );
        return null;
      };
      if (hasWaiting() || !navigator.onLine) return queue();
      const send = files.length
        ? notesApi.createWithFiles(
            channelId,
            content,
            files,
            reminder,
            clientId,
          )
        : notesApi.create(channelId, content, reminder, clientId);
      return send.catch((error: unknown) => {
        if (unreachable(error)) return queue();
        throw error;
      });
    },
    onSuccess: (sent) => {
      if (sent === null) {
        toast("No connection. The message will send when you're back online.", {
          id: "outbox",
        });
        void flushOutbox(queryClient);
        return;
      }
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: ["notes", channelId] }),
        queryClient.invalidateQueries({ queryKey: ["search"] }),
        queryClient.invalidateQueries({ queryKey: ["publishing"] }),
        queryClient.invalidateQueries({ queryKey: ["home-activity"] }),
      ]);
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
