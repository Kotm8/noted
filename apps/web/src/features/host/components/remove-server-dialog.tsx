import { Notice } from "../../../components/ui/notice";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "../../../components/ui/button";
import { Modal } from "../../../components/ui/dialog";
import { hostApi } from "../api";

export function RemoveServerDialog({
  onClose,
  instance,
  instanceId,
}: {
  onClose: () => void;
  instance: string;
  instanceId: string;
}) {
  const [confirmation, setConfirmation] = useState("");
  const [password, setPassword] = useState("");
  const [saved, setSaved] = useState(false);
  const removal = useMutation({
    mutationFn: hostApi.remove,
    onSuccess: () => {
      setPassword("");
      setConfirmation("");
    },
  });
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && !removal.isPending) onClose();
      }}
      title="Permanently delete this server"
      description={`Remove Noted from ${instance}. This cannot be undone.`}
      className="host-dialog"
    >
      {removal.isSuccess ? (
        <Notice tone="warning">
          <p>
            Removal has been requested. This app will disconnect as its containers and data are
            deleted. Closing this page does not cancel removal.
          </p>
          <p>The VPS itself and unrelated apps are kept.</p>
        </Notice>
      ) : (
        <form
          className="host-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (confirmation === "I LOVE VERITY" && saved)
              removal.mutate({ confirmation, current_password: password, instance_id: instanceId });
          }}
        >
          <Notice tone="warning" role="note">
            <strong>All Noted data on this VPS will be permanently deleted.</strong>
            <p>
              This includes the owner account, projects, channels, messages, uploads, TLS data,
              server-side backups, and the update worker. Downloaded backup ZIPs remain yours. The
              operating system, Docker, and other apps stay intact.
            </p>
          </Notice>
          <label className="check-label">
            <input
              type="checkbox"
              checked={saved}
              onChange={(event) => setSaved(event.target.checked)}
              required
            />
            I have saved any backup I need and understand that this deletion is permanent.
          </label>
          <label>
            Current owner password
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              maxLength={256}
            />
          </label>
          <label>
            Type I LOVE VERITY exactly to confirm
            <input
              aria-label="Server deletion confirmation"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          {removal.error && <Notice tone="error">{removal.error.message}</Notice>}
          <div className="host-actions">
            <Button
              variant="secondary"
              type="button"
              onClick={onClose}
              disabled={removal.isPending}
            >
              Keep server
            </Button>
            <Button
              variant="danger"
              disabled={
                removal.isPending || !saved || !password || confirmation !== "I LOVE VERITY"
              }
            >
              {removal.isPending
                ? "Requesting removal..."
                : "Permanently delete Noted and its data"}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
