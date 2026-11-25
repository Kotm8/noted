import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ConfirmDialog } from "../../components/ui/confirm-dialog";
import { Modal } from "../../components/ui/dialog";
import { Notice } from "../../components/ui/notice";
import { androidPilot } from "../../lib/android-pilot";
import { LogDock } from "./log-dock";
import type { NutritionState } from "./types";

export function LogMealDialog({
  state,
  day,
  label = day,
  minute,
  className,
  sharedCapture,
  close,
}: {
  state: NutritionState;
  day: string;
  label?: string;
  minute: number;
  className?: string;
  sharedCapture?: string;
  close: () => void;
}) {
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const capture = useQuery({
    queryKey: ["shared-meal-photos", sharedCapture],
    queryFn: () => androidPilot.sharedPhotos(),
    enabled: Boolean(sharedCapture),
  });
  const onDraftState = useCallback((dirty: boolean, saving: boolean) => {
    setDirty(dirty);
    setSaving(saving);
  }, []);
  function finish() {
    const ids = capture.data?.photos.map((photo) => photo.id);
    if (ids?.length) {
      void androidPilot
        .discardSharedPhotos({ ids })
        .catch(() =>
          toast.error("Couldn't clear the shared photos from this phone."),
        );
    }
    close();
  }

  return (
    <>
      <Modal
        open
        title="Log meal"
        description={label}
        className={`log-meal-dialog ${className ?? ""}`}
        onOpenChange={(open) => {
          if (open || saving || confirm) return;
          if (dirty || capture.data?.photos.length) setConfirm(true);
          else close();
        }}
      >
        {capture.error && <Notice tone="error">{capture.error.message}</Notice>}
        <LogDock
          state={state}
          day={day}
          nowMinute={minute}
          sharedPhotos={capture.data?.photos}
          onSaved={finish}
          onDraftState={onDraftState}
        />
      </Modal>
      <ConfirmDialog
        open={confirm}
        title="Discard this meal?"
        description="Your meal draft, photos and estimate will be cleared."
        keepLabel="Keep editing"
        confirmLabel="Discard meal"
        onClose={() => setConfirm(false)}
        onConfirm={finish}
      />
    </>
  );
}
