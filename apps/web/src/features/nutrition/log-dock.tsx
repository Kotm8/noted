import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowUp, Camera, ImagePlus, LoaderCircle, X } from "lucide-react";
import { toast } from "sonner";
import { Notice } from "../../components/ui/notice";
import { Button } from "../../components/ui/button";
import type { SharedMealPhoto } from "../../lib/android-pilot";
import { AiSources } from "../ai/components/ai-feedback";
import { nutritionApi, photoUrl, streamEstimate } from "./api";
import { MealEditor, StreamingEstimate, type MealDraft } from "./meal-editor";
import { RunStatus } from "./parts";
import { slotFor, type MealEstimate, type NutritionState } from "./types";
import { useNutritionRun } from "./use-nutrition-run";

interface Photo {
  key: string;
  id: string | null;
  preview: string;
}

const MAX_PHOTOS = 4;

/** L01: describe the meal, add photos, or both; the estimate streams in above the composer. */
export function LogDock({
  state,
  day,
  nowMinute,
  onSaved,
  onDraftState,
  sharedPhotos,
}: {
  state: NutritionState;
  day: string;
  nowMinute: number;
  onSaved?: () => void;
  onDraftState?: (dirty: boolean, saving: boolean) => void;
  sharedPhotos?: SharedMealPhoto[];
}) {
  const client = useQueryClient();
  const [text, setText] = useState("");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [sentPhotos, setSentPhotos] = useState<string[]>([]);
  const [sharedFailed, setSharedFailed] = useState(false);
  const [sharedRetry, setSharedRetry] = useState(0);
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const previews = useRef(new Set<string>());
  const loadedShares = useRef(new Set<string>());
  const slots = useRef(0);
  const run = useNutritionRun<MealEstimate>();
  const uploading = photos.some((photo) => photo.id === null);
  useEffect(() => {
    const urls = previews.current;
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.clear();
    };
  }, []);

  function releasePreview(url: string) {
    URL.revokeObjectURL(url);
    previews.current.delete(url);
  }

  async function add(files: ArrayLike<File> | null) {
    const chosen = Array.from(files ?? []).slice(0, MAX_PHOTOS - slots.current);
    slots.current += chosen.length;
    let added = 0;
    for (const file of chosen) {
      const key = `${file.name}-${Date.now()}-${Math.random()}`;
      const preview = URL.createObjectURL(file);
      previews.current.add(preview);
      setPhotos((before) => [...before, { key, id: null, preview }]);
      try {
        const saved = await nutritionApi.uploadPhoto(file);
        added += 1;
        setPhotos((before) =>
          before.map((photo) =>
            photo.key === key ? { ...photo, id: saved.id } : photo,
          ),
        );
      } catch (error) {
        slots.current = Math.max(0, slots.current - 1);
        releasePreview(preview);
        setPhotos((before) => before.filter((photo) => photo.key !== key));
        toast.error((error as Error).message);
      }
    }
    return added;
  }

  const loadShared = useEffectEvent(
    async (items: SharedMealPhoto[], signal: AbortSignal) => {
      let failed = false;
      for (const item of items) {
        if (
          signal.aborted ||
          loadedShares.current.has(item.id) ||
          slots.current >= MAX_PHOTOS
        )
          continue;
        try {
          const response = await fetch(
            `/incoming/${encodeURIComponent(item.id)}`,
            { signal },
          );
          if (!response.ok) throw new Error("Couldn't read the shared photo.");
          const blob = await response.blob();
          if (signal.aborted) return;
          const count = await add([
            new File([blob], item.name, { type: blob.type }),
          ]);
          if (count) loadedShares.current.add(item.id);
          else failed = true;
        } catch (error) {
          failed = true;
          if (!signal.aborted) toast.error((error as Error).message);
        }
      }
      if (!signal.aborted) setSharedFailed(failed);
    },
  );
  useEffect(() => {
    if (!sharedPhotos?.length) return;
    const controller = new AbortController();
    void loadShared(sharedPhotos, controller.signal);
    return () => controller.abort();
  }, [sharedPhotos, sharedRetry]);

  function send(said = text.trim()) {
    const ids = photos.flatMap((photo) => (photo.id ? [photo.id] : []));
    if ((!said && !ids.length) || uploading) return;
    setSentPhotos(ids);
    void run.start((onEvent, signal) =>
      streamEstimate({ text: said, photo_ids: ids }, onEvent, signal),
    );
  }

  function answer(question: string, reply: string) {
    const said = `${text.trim()}\n${question} ${reply}`.trim();
    setText(said);
    send(said);
  }

  function reset() {
    run.cancel();
    photos.forEach((photo) => releasePreview(photo.preview));
    slots.current = 0;
    setPhotos([]);
    setSentPhotos([]);
    setText("");
  }

  const save = useMutation({
    mutationFn: ({
      draft,
      remember,
    }: {
      draft: MealDraft;
      remember: boolean;
    }) => {
      const output = run.output!;
      const saved = state.saved_meals.find(
        (item) => item.name === output.saved_meal,
      );
      return nutritionApi.addMeal({
        day,
        minute: draft.minute,
        slot: draft.slot,
        name: draft.name,
        items: draft.items,
        source: saved ? "saved" : "ai",
        saved_meal_id: saved?.id ?? null,
        photo_ids: draft.photo_ids,
        remember: remember && !saved,
      });
    },
    onSuccess: async (meal) => {
      reset();
      await client.invalidateQueries({ queryKey: ["nutrition"] });
      toast.success(`${meal.slot} saved`, {
        action: {
          label: "Undo",
          onClick: () =>
            void nutritionApi
              .removeMeal(meal)
              .then(() => client.invalidateQueries({ queryKey: ["nutrition"] }))
              .catch((error: Error) => toast.error(error.message)),
        },
      });
      onSaved?.();
    },
  });
  const dirty = Boolean(text || photos.length || run.stage !== "idle");
  useEffect(() => {
    onDraftState?.(dirty, save.isPending);
  }, [dirty, onDraftState, save.isPending]);

  if (run.stage === "done" && run.output) {
    const output = run.output;
    const minute = nowMinute;
    return (
      <div className="nutrition-dock">
        <MealEditor
          key={output.name + output.items.length}
          initial={{
            name: output.name || "Meal",
            slot: output.slot ?? slotFor(minute),
            minute,
            items: output.items,
            photo_ids: sentPhotos,
          }}
          question={output.question}
          note={output.note}
          rememberable={
            !state.saved_meals.some((item) => item.name === output.saved_meal)
          }
          saving={save.isPending}
          error={save.error?.message}
          status={
            <>
              <RunStatus run={run} />
              <AiSources sources={run.sources} />
            </>
          }
          onSave={(draft, remember) => save.mutate({ draft, remember })}
          onDiscard={reset}
          onAnswer={
            output.question
              ? (reply) => answer(output.question!.text, reply)
              : undefined
          }
        />
      </div>
    );
  }
  if (run.stage !== "idle" && run.stage !== "error")
    return (
      <div className="nutrition-dock">
        <StreamingEstimate
          items={run.items}
          photoId={sentPhotos[0]}
          status={
            <RunStatus
              run={run}
              thinking={
                sentPhotos.length ? "Looking at your photo" : "Thinking"
              }
            />
          }
          onCancel={reset}
        />
      </div>
    );
  return (
    <div className="nutrition-dock">
      {sharedFailed && (
        <Notice tone="error">
          Some shared photos could not be uploaded.
          <Button
            size="small"
            variant="ghost"
            onClick={() => {
              setSharedFailed(false);
              setSharedRetry((value) => value + 1);
            }}
          >
            Retry photos
          </Button>
        </Notice>
      )}
      {run.stage === "error" && (
        <Notice tone="error">
          {run.error}
          {["limit", "auth", "model"].includes(run.code ?? "") && (
            <Button
              variant="ghost"
              size="small"
              onClick={() =>
                window.dispatchEvent(new Event("noted:ai-settings"))
              }
            >
              Open AI settings
            </Button>
          )}
        </Notice>
      )}
      <form
        className="nutrition-composer"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        {photos.length > 0 && (
          <div className="composer-photos">
            {photos.map((photo) => (
              <span key={photo.key} className="composer-photo">
                <img
                  src={photo.id ? photoUrl(photo.id) : photo.preview}
                  alt="Meal photo"
                />
                {photo.id === null && (
                  <LoaderCircle size={16} className="spin" />
                )}
                <button
                  type="button"
                  aria-label="Remove photo"
                  onClick={() => {
                    releasePreview(photo.preview);
                    slots.current = Math.max(0, slots.current - 1);
                    setPhotos((before) =>
                      before.filter((item) => item.key !== photo.key),
                    );
                  }}
                >
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="composer-row">
          <button
            type="button"
            className="icon-button"
            aria-label="Take a photo"
            title="Take a photo"
            disabled={photos.length >= MAX_PHOTOS}
            onClick={() => camera.current?.click()}
          >
            <Camera size={18} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Add a photo"
            title="Add a photo"
            disabled={photos.length >= MAX_PHOTOS}
            onClick={() => gallery.current?.click()}
          >
            <ImagePlus size={17} />
          </button>
          <textarea
            rows={1}
            aria-label="Describe your meal"
            placeholder="Describe a meal or add a photo"
            maxLength={2000}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                send();
              }
            }}
          />
          <button
            type="submit"
            className="nutrition-send"
            aria-label="Estimate"
            disabled={uploading || (!text.trim() && !photos.length)}
          >
            <ArrowUp size={17} />
          </button>
        </div>
        <input
          ref={camera}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(event) => {
            void add(event.target.files);
            event.target.value = "";
          }}
        />
        <input
          ref={gallery}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          hidden
          onChange={(event) => {
            void add(event.target.files);
            event.target.value = "";
          }}
        />
      </form>
    </div>
  );
}
