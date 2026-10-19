import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArrowDown,
  ArrowUp,
  GripVertical,
  Info,
  Pencil,
  Plus,
  RotateCcw,
} from "lucide-react";
import type { CSSProperties } from "react";
import { toast } from "sonner";
import { Button } from "../../../components/ui/button";
import { Notice } from "../../../components/ui/notice";
import { trackingApi } from "../api";
import { activityIcons } from "../types";
import type { Activity, ActivityIconName } from "../types";
import { ActivityGlyphIcon, ActivityIcon } from "./activity-icon";

const colors = [
  "#e2c15a",
  "#9db9ce",
  "#91b8a0",
  "#b4a2cb",
  "#d3a18a",
  "#adadb2",
];

export function ActivitiesSettings({ activities }: { activities: Activity[] }) {
  const [editing, setEditing] = useState<Activity | "new" | null>(null);
  const [dragged, setDragged] = useState<string | null>(null);
  const client = useQueryClient();
  const invalidate = () => {
    void client.invalidateQueries({ queryKey: ["activities"] });
    void client.invalidateQueries({ queryKey: ["time-tracker"] });
    void client.invalidateQueries({ queryKey: ["schedule"] });
  };
  const update = useMutation({
    mutationFn: trackingApi.updateActivity,
    onSuccess: invalidate,
    onError: (error) => {
      toast.error(error.message);
      invalidate();
    },
  });
  const order = useMutation({
    mutationFn: trackingApi.reorder,
    onSuccess: (data) => client.setQueryData(["activities"], data),
    onError: (error) => {
      toast.error(error.message);
      invalidate();
    },
  });
  function move(from: number, to: number) {
    if (to < 0 || to >= activities.length || from === to || order.isPending)
      return;
    const ids = activities.map((item) => item.id);
    const [id] = ids.splice(from, 1);
    ids.splice(to, 0, id);
    order.mutate(ids);
  }
  return (
    <>
      <div className="tracking-section-heading">
        <h3>Your activities</h3>
        <Button
          variant="secondary"
          size="small"
          onClick={() => setEditing("new")}
        >
          <Plus size={14} />
          New activity
        </Button>
      </div>
      <div className="tracking-activity-list">
        {activities.map((item, index) => (
          <div
            key={item.id}
            draggable={!order.isPending}
            onDragStart={(event) => {
              setDragged(item.id);
              event.dataTransfer.setData("text/plain", item.id);
            }}
            onDragOver={(event) => {
              if (dragged) event.preventDefault();
            }}
            onDragEnd={() => setDragged(null)}
            onDrop={(event) => {
              event.preventDefault();
              const from = activities.findIndex(
                (entry) => entry.id === dragged,
              );
              if (from >= 0) move(from, index);
              setDragged(null);
            }}
            className={`tracking-activity-row ${item.archived ? "archived" : ""}`}
          >
            <GripVertical className="tracking-drag-handle" size={14} />
            <ActivityIcon activity={item} />
            <span>
              {item.name}
              {item.archived && <small>Archived</small>}
            </span>
            <button
              className="icon-button"
              disabled={!index || order.isPending}
              aria-label={`Move ${item.name} up`}
              onClick={() => move(index, index - 1)}
            >
              <ArrowUp size={14} />
            </button>
            <button
              className="icon-button"
              disabled={index === activities.length - 1 || order.isPending}
              aria-label={`Move ${item.name} down`}
              onClick={() => move(index, index + 1)}
            >
              <ArrowDown size={14} />
            </button>
            <button
              className="icon-button"
              aria-label={`Edit ${item.name}`}
              onClick={() => setEditing(item)}
            >
              <Pencil size={14} />
            </button>
            <button
              className="icon-button"
              disabled={update.isPending}
              aria-label={`${item.archived ? "Restore" : "Archive"} ${item.name}`}
              onClick={() =>
                update.mutate({ ...item, archived: !item.archived })
              }
            >
              {item.archived ? <RotateCcw size={14} /> : <Archive size={14} />}
            </button>
          </div>
        ))}
      </div>
      <p className="schedule-help">
        <Info size={14} />
        Drag or use the arrows to reorder. Archiving an activity stops its timer
        and keeps its history.
      </p>
      {editing && (
        <ActivityForm
          key={editing === "new" ? "new" : editing.id}
          item={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            invalidate();
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

function ActivityForm({
  item,
  onClose,
  onSaved,
}: {
  item?: Activity;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(item?.name ?? "");
  const [icon, setIcon] = useState<ActivityIconName>(item?.icon ?? "Activity");
  const [color, setColor] = useState(item?.color ?? colors[0]);
  const save = useMutation({
    mutationFn: () =>
      item
        ? trackingApi.updateActivity({ ...item, name, icon, color })
        : trackingApi.createActivity({ name, icon, color }),
    onSuccess: onSaved,
  });
  return (
    <form
      className="tracking-activity-form"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <h3>{item ? "Edit activity" : "New activity"}</h3>
      <label>
        Activity name
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={60}
          required
          autoFocus
        />
      </label>
      <fieldset>
        <legend>Icon</legend>
        <div className="tracking-icon-options">
          {activityIcons.map((value) => (
            <button
              key={value}
              type="button"
              aria-label={`${value} icon`}
              aria-pressed={icon === value}
              onClick={() => setIcon(value)}
            >
              <ActivityGlyphIcon name={value} />
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>Color</legend>
        <div className="tracking-color-options">
          {colors.map((value) => (
            <button
              key={value}
              style={{ "--activity": value } as CSSProperties}
              aria-label={`Color ${value}`}
              aria-pressed={value === color}
              type="button"
              onClick={() => setColor(value)}
            />
          ))}
          <label className="tracking-custom-color">
            Custom
            <input
              type="color"
              value={color}
              aria-label="Custom activity color"
              onChange={(event) => setColor(event.target.value)}
            />
          </label>
        </div>
      </fieldset>
      {save.error && <Notice tone="error">{save.error.message}</Notice>}
      <div className="dialog-actions">
        <Button variant="ghost" type="button" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {item ? "Save activity" : "Add activity"}
        </Button>
      </div>
    </form>
  );
}
