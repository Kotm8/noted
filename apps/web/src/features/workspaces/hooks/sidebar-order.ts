import type { SidebarMove, SidebarOrder } from "../types";

export function moveSidebarItem(
  order: SidebarOrder,
  move: SidebarMove,
): SidebarOrder {
  if (move.before_id === move.id) return order;
  if (move.kind === "category") {
    const item = order.categories.find((entry) => entry.id === move.id);
    if (!item) return order;
    const categories = order.categories.filter((entry) => entry.id !== move.id);
    const index =
      move.before_id === null
        ? categories.length
        : categories.findIndex((entry) => entry.id === move.before_id);
    if (index < 0) return order;
    categories.splice(index, 0, item);
    return {
      ...order,
      categories: categories.map((entry, position) => ({ ...entry, position })),
    };
  }
  const item = order.channels.find((entry) => entry.id === move.id);
  if (!item) return order;
  const categoryId = move.category_id ?? null;
  const group = order.channels.filter(
    (entry) => entry.category_id === categoryId && entry.id !== item.id,
  );
  const index =
    move.before_id === null
      ? group.length
      : group.findIndex((entry) => entry.id === move.before_id);
  if (index < 0) return order;
  group.splice(index, 0, { ...item, category_id: categoryId });
  return {
    ...order,
    channels: [
      ...order.channels.filter(
        (entry) => entry.category_id !== categoryId && entry.id !== item.id,
      ),
      ...group.map((entry, position) => ({ ...entry, position })),
    ],
  };
}
