import { ChevronDown, ChevronRight, MoreHorizontal, Plus } from "lucide-react";
import { Menu, MenuItem } from "../../../components/ui/menu";
import type { Category, Channel, OpenManagement } from "../types";
import { ChannelRow } from "./channel-row";

interface CategorySectionProps {
  category: Category;
  channels: Channel[];
  selectedChannelId?: string;
  collapsed: boolean;
  onToggle: () => void;
  onSelect: (channel: Channel) => void;
  onManage: OpenManagement;
}

export function CategorySection({
  category,
  channels,
  selectedChannelId,
  collapsed,
  onToggle,
  onSelect,
  onManage,
}: CategorySectionProps) {
  return (
    <section className="category">
      <div className="category-heading">
        <button className="category-toggle" onClick={onToggle} aria-expanded={!collapsed}>
          {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
          <span>{category.name}</span>
        </button>

        <div className="category-actions">
          <button
            className="icon-button"
            aria-label={`Add channel to ${category.name}`}
            onClick={() =>
              onManage({
                kind: "channel",
                workspaceId: category.workspace_id,
                categoryId: category.id,
              })
            }
          >
            <Plus size={14} />
          </button>
          <Menu
            trigger={
              <button className="icon-button" aria-label={`Options for category ${category.name}`}>
                <MoreHorizontal size={14} />
              </button>
            }
          >
            <MenuItem
              onSelect={() =>
                onManage({ kind: "category", workspaceId: category.workspace_id, item: category })
              }
            >
              Rename category
            </MenuItem>
            <MenuItem
              danger
              onSelect={() =>
                onManage({
                  kind: "category",
                  workspaceId: category.workspace_id,
                  item: category,
                  deleting: true,
                })
              }
            >
              Delete category
            </MenuItem>
          </Menu>
        </div>
      </div>

      {!collapsed &&
        channels.map((channel) => (
          <ChannelRow
            key={channel.id}
            channel={channel}
            selected={channel.id === selectedChannelId}
            onSelect={onSelect}
            onManage={onManage}
          />
        ))}
    </section>
  );
}
