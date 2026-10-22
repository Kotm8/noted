import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type HTMLAttributes,
} from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { isAndroidApp } from "../../notifications/android";
import { workspaceApi } from "../api";
import type { Category, Channel, SidebarMove, SidebarOrder } from "../types";
import { moveSidebarItem } from "./sidebar-order";

type DragItem = { kind: "channel" | "category"; id: string };
type Marker = { key: string; edge: "before" | "after" | "inside" };
type DragProps = HTMLAttributes<HTMLElement> & {
  "data-drop"?: string;
  "data-dragging"?: boolean;
};

export function useSidebarReorder(
  workspaceId: string | undefined,
  order: SidebarOrder,
) {
  const client = useQueryClient();
  const [desktop, setDesktop] = useState(false);
  const [dragged, setDragged] = useState<DragItem | null>(null);
  const source = useRef<DragItem | null>(null);
  const pointer = useRef("mouse");
  const [marker, setMarker] = useState<Marker | null>(null);
  useEffect(() => {
    const media = window.matchMedia(
      "(min-width: 761px) and (hover: hover) and (pointer: fine)",
    );
    const update = () => setDesktop(media.matches && !isAndroidApp());
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  function clear() {
    source.current = null;
    setDragged(null);
    setMarker(null);
  }

  useEffect(() => clear(), [workspaceId]);

  const save = useMutation({
    mutationFn: ({
      workspaceId,
      move,
    }: {
      workspaceId: string;
      move: SidebarMove;
    }) => workspaceApi.move(workspaceId, move),
    onMutate: async ({ workspaceId, move }) => {
      const categoryKey = ["categories", workspaceId];
      const channelKey = ["channels", workspaceId];
      await Promise.all([
        client.cancelQueries({ queryKey: categoryKey }),
        client.cancelQueries({ queryKey: channelKey }),
      ]);
      const categories = client.getQueryData<Category[]>(categoryKey);
      const channels = client.getQueryData<Channel[]>(channelKey);
      if (categories && channels) {
        const next = moveSidebarItem({ categories, channels }, move);
        client.setQueryData(categoryKey, next.categories);
        client.setQueryData(channelKey, next.channels);
      }
      return { categories, channels };
    },
    onSuccess: (data, { workspaceId }) => {
      client.setQueryData(["categories", workspaceId], data.categories);
      client.setQueryData(["channels", workspaceId], data.channels);
    },
    onError: (error, { workspaceId }, previous) => {
      if (previous?.categories)
        client.setQueryData(["categories", workspaceId], previous.categories);
      if (previous?.channels)
        client.setQueryData(["channels", workspaceId], previous.channels);
      toast.error(error.message);
      void client.invalidateQueries({ queryKey: ["categories", workspaceId] });
      void client.invalidateQueries({ queryKey: ["channels", workspaceId] });
    },
  });
  const enabled = desktop && Boolean(workspaceId) && !save.isPending;

  function start(item: DragItem): DragProps {
    return {
      draggable: enabled,
      onPointerDown: (event) => {
        pointer.current = event.pointerType;
      },
      onDragStart: (event) => {
        if (
          !enabled ||
          pointer.current !== "mouse" ||
          (event.target as HTMLElement).closest(
            ".channel-options, .category-actions",
          )
        ) {
          event.preventDefault();
          return;
        }
        event.stopPropagation();
        source.current = item;
        setDragged(item);
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("application/x-noted-sidebar", item.id);
      },
      onDragEnd: clear,
    };
  }

  function accept(event: DragEvent, next: Marker) {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    setMarker((current) =>
      current?.key === next.key && current.edge === next.edge ? current : next,
    );
    const tree = event.currentTarget.closest(".channel-tree");
    if (tree) {
      const bounds = tree.getBoundingClientRect();
      if (event.clientY < bounds.top + 36) tree.scrollTop -= 12;
      else if (event.clientY > bounds.bottom - 36) tree.scrollTop += 12;
    }
  }

  function drop(event: DragEvent, move: SidebarMove) {
    event.preventDefault();
    event.stopPropagation();
    if (enabled && workspaceId && source.current && move.id !== move.before_id)
      save.mutate({ workspaceId, move });
    clear();
  }

  function channelTarget(channel: Channel, event: DragEvent) {
    const rect = event.currentTarget.getBoundingClientRect();
    const edge =
      event.clientY < rect.top + rect.height / 2 ? "before" : "after";
    const group = order.channels.filter(
      (item) =>
        item.category_id === channel.category_id &&
        item.id !== source.current?.id,
    );
    const index = group.findIndex((item) => item.id === channel.id);
    return {
      edge,
      before: edge === "before" ? channel.id : (group[index + 1]?.id ?? null),
    } as const;
  }

  function channelProps(channel: Channel): DragProps {
    return {
      ...start({ kind: "channel", id: channel.id }),
      "data-dragging": dragged?.id === channel.id || undefined,
      "data-drop": marker?.key === channel.id ? marker.edge : undefined,
      onDragOver: (event) => {
        if (!enabled || source.current?.kind !== "channel") return;
        if (source.current.id === channel.id) {
          event.preventDefault();
          event.stopPropagation();
          setMarker(null);
          return;
        }
        accept(event, {
          key: channel.id,
          edge: channelTarget(channel, event).edge,
        });
      },
      onDrop: (event) => {
        if (source.current?.kind !== "channel") return;
        if (source.current.id === channel.id) {
          event.preventDefault();
          event.stopPropagation();
          clear();
          return;
        }
        drop(event, {
          kind: "channel",
          id: source.current.id,
          category_id: channel.category_id,
          before_id: channelTarget(channel, event).before,
        });
      },
    };
  }

  function categoryProps(category: Category): DragProps {
    function destination(event: DragEvent) {
      const rect = event.currentTarget.getBoundingClientRect();
      const edge =
        event.clientY < rect.top + rect.height / 2 ? "before" : "after";
      const categories = order.categories.filter(
        (item) => item.id !== source.current?.id,
      );
      const index = categories.findIndex((item) => item.id === category.id);
      return {
        edge,
        before:
          edge === "before" ? category.id : (categories[index + 1]?.id ?? null),
      } as const;
    }
    return {
      "data-dragging": dragged?.id === category.id || undefined,
      "data-drop": marker?.key === category.id ? marker.edge : undefined,
      onDragOver: (event) => {
        if (!enabled || !source.current || source.current.id === category.id)
          return;
        accept(event, {
          key: category.id,
          edge:
            source.current.kind === "channel"
              ? "inside"
              : destination(event).edge,
        });
      },
      onDrop: (event) => {
        const item = source.current;
        if (!item || item.id === category.id) return;
        drop(
          event,
          item.kind === "channel"
            ? { ...item, category_id: category.id, before_id: null }
            : { ...item, before_id: destination(event).before },
        );
      },
    };
  }

  const ungroupedProps: DragProps = {
    "data-drop": marker?.key === "ungrouped" ? "inside" : undefined,
    onDragOver: (event) => {
      if (enabled && source.current?.kind === "channel")
        accept(event, { key: "ungrouped", edge: "inside" });
    },
    onDrop: (event) => {
      if (source.current?.kind === "channel")
        drop(event, { ...source.current, category_id: null, before_id: null });
    },
  };
  return {
    channelProps,
    categoryProps,
    categoryHandle: (id: string) => start({ kind: "category", id }),
    ungroupedProps,
    draggingChannel: dragged?.kind === "channel",
    clearMarker: () => setMarker(null),
  };
}

export type SidebarReorder = ReturnType<typeof useSidebarReorder>;
