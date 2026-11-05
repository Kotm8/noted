import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Apple,
  Bookmark,
  ImageIcon,
  LoaderCircle,
  Pencil,
  Repeat,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "../../components/ui/button";
import { ConfirmDialog } from "../../components/ui/confirm-dialog";
import { nutritionApi } from "./api";
import { MealEditor } from "./meal-editor";
import { MealPhoto } from "./parts";
import { kcal, totals, type Meal } from "./types";

const time = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

export function MealCard({
  meal,
  open,
  onToggle,
  savedNames,
  logDay,
  nowMinute,
}: {
  meal: Meal;
  open: boolean;
  onToggle: () => void;
  savedNames: string[];
  logDay: string;
  nowMinute: number;
}) {
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const refresh = () => client.invalidateQueries({ queryKey: ["nutrition"] });
  const sum = totals(meal.items);
  const remembered =
    Boolean(meal.saved_meal_id) || savedNames.includes(meal.name);
  const edit = useMutation({
    mutationFn: (fields: Parameters<typeof nutritionApi.editMeal>[1]) =>
      nutritionApi.editMeal(meal.id, fields),
    onSuccess: async () => {
      setEditing(false);
      await refresh();
    },
  });
  const again = useMutation({
    mutationFn: () =>
      nutritionApi.addMeal({
        day: logDay,
        minute: nowMinute,
        slot: meal.slot,
        name: meal.name,
        items: meal.items,
        source: meal.saved_meal_id ? "saved" : "manual",
        saved_meal_id: meal.saved_meal_id,
        photo_ids: [],
        remember: false,
      }),
    onSuccess: async (added) => {
      await refresh();
      toast.success(`${meal.name} logged again`, {
        action: {
          label: "Undo",
          onClick: () => void nutritionApi.removeMeal(added).then(refresh),
        },
      });
    },
    onError: (error) => toast.error(error.message),
  });
  const remember = useMutation({
    mutationFn: () => nutritionApi.addSaved(meal.name, meal.items),
    onSuccess: async () => {
      await refresh();
      toast.success(`“${meal.name}” is a saved meal now`);
    },
    onError: (error) => toast.error(error.message),
  });
  const picture = useMutation({
    mutationFn: () => nutritionApi.makePicture(meal.id),
    onSuccess: refresh,
    onError: (error) => toast.error(error.message),
  });
  const remove = useMutation({
    mutationFn: () => nutritionApi.removeMeal(meal),
    onSuccess: async () => {
      setDeleting(false);
      await refresh();
    },
    onError: (error) => toast.error(error.message),
  });

  if (editing)
    return (
      <MealEditor
        initial={{
          name: meal.name,
          slot: meal.slot,
          minute: meal.minute,
          items: meal.items,
          photo_ids: meal.photo_ids,
        }}
        rememberable={!remembered}
        saveLabel="Save changes"
        saving={edit.isPending}
        error={edit.error?.message}
        onDiscard={() => setEditing(false)}
        onSave={(draft, rememberIt) =>
          edit.mutate({
            ...draft,
            day: meal.day,
            source: meal.source,
            saved_meal_id: meal.saved_meal_id,
            remember: rememberIt,
            revision: meal.revision,
          })
        }
      />
    );

  return (
    <article className={`nutrition-meal${open ? " open" : ""}`}>
      <button
        type="button"
        className="meal-head"
        aria-expanded={open}
        onClick={onToggle}
      >
        {meal.photo_ids[0] ? (
          <MealPhoto id={meal.photo_ids[0]} />
        ) : (
          <span className="meal-glyph">
            {meal.saved_meal_id ? <Bookmark size={16} /> : <Apple size={16} />}
          </span>
        )}
        <span className="meal-name">
          <strong>{meal.name}</strong>
          <small>
            {time(meal.minute)}
            {meal.saved_meal_id ? " · Saved meal" : ""} · {meal.items.length}{" "}
            item{meal.items.length === 1 ? "" : "s"}
          </small>
        </span>
        <span className="meal-kcal">
          <strong>{kcal(sum.kcal)}</strong>
          <small>kcal</small>
        </span>
      </button>
      {open && (
        <>
          <ul className="meal-items">
            {meal.items.map((item, index) => (
              <li key={index}>
                <span>
                  {item.name}
                  <small>{item.amount}</small>
                </span>
                <span className="item-macros">
                  P {Math.round(item.protein)} · C {Math.round(item.carbs)} · F{" "}
                  {Math.round(item.fat)}
                </span>
                <strong>{item.kcal}</strong>
              </li>
            ))}
          </ul>
          <div className="meal-actions">
            <Button
              variant="ghost"
              size="small"
              onClick={() => setEditing(true)}
            >
              <Pencil size={14} />
              Edit
            </Button>
            <Button
              variant="ghost"
              size="small"
              disabled={again.isPending}
              onClick={() => again.mutate()}
            >
              <Repeat size={14} />
              Log again
            </Button>
            {!remembered && (
              <Button
                variant="ghost"
                size="small"
                disabled={remember.isPending}
                onClick={() => remember.mutate()}
              >
                <Bookmark size={14} />
                Remember
              </Button>
            )}
            {!meal.photo_ids.length && (
              <Button
                variant="ghost"
                size="small"
                disabled={picture.isPending}
                onClick={() => picture.mutate()}
              >
                {picture.isPending ? (
                  <LoaderCircle size={14} className="spin" />
                ) : (
                  <ImageIcon size={14} />
                )}
                {picture.isPending ? "Making a picture…" : "Make a picture"}
              </Button>
            )}
            <span className="spacer" />
            <button
              type="button"
              className="icon-button danger"
              aria-label={`Delete ${meal.name}`}
              onClick={() => setDeleting(true)}
            >
              <Trash2 size={14} />
            </button>
          </div>
        </>
      )}
      <ConfirmDialog
        open={deleting}
        pending={remove.isPending}
        title={`Delete ${meal.name}?`}
        description="Its photos are deleted too."
        keepLabel="Keep it"
        confirmLabel="Delete"
        onClose={() => setDeleting(false)}
        onConfirm={() => remove.mutate()}
      />
    </article>
  );
}
