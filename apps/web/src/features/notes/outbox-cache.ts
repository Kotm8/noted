import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import type { Note, NotePage } from "./types";
import type { ThreadPage } from "../threads/api";

export function cacheDelivered(client: QueryClient, note: Note) {
  if (note.thread_root_id) {
    client.setQueryData<InfiniteData<ThreadPage>>(
      ["thread", note.thread_root_id, "latest"],
      (data) =>
        data && {
          ...data,
          pages: data.pages.map((page, index) =>
            index
              ? page
              : {
                  ...page,
                  replies: {
                    ...page.replies,
                    items: append(page.replies.items, note),
                  },
                },
          ),
        },
    );
  } else {
    client.setQueryData<InfiniteData<NotePage>>(
      ["notes", note.channel_id, "latest"],
      (data) =>
        data && {
          ...data,
          pages: data.pages.map((page, index) =>
            index
              ? page
              : {
                  ...page,
                  items: append(page.items, note),
                },
          ),
        },
    );
  }
}

function append(items: Note[], note: Note) {
  return [...items.filter((item) => item.id !== note.id), note].sort(
    (left, right) =>
      left.created_at.localeCompare(right.created_at) ||
      left.id.localeCompare(right.id),
  );
}
