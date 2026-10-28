import { Notice } from "../../../components/ui/notice";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "../../../components/ui/button";
import { CopyBox } from "../../../components/ui/copy-box";
import { Modal } from "../../../components/ui/dialog";
import { hostApi } from "../api";
import type { HostJob } from "../types";
import {
  generatedDomain,
  isGeneratedDomain,
} from "../../../lib/generated-domain";

export function TransferDialog({
  onClose,
  onQueued,
  job,
  ownerUsername,
  instance,
}: {
  onClose: () => void;
  onQueued: (job: HostJob) => void;
  job: HostJob | null;
  ownerUsername: string;
  /** The current address; an sslip.io one follows the server to its new IP. */
  instance: string;
}) {
  const addressMoves = isGeneratedDomain(instance);
  const [ip, setIp] = useState("");
  const [port, setPort] = useState("22");
  const [sshPassword, setSshPassword] = useState("");
  const [username, setUsername] = useState(ownerUsername);
  const [newPassword, setNewPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [password, setPassword] = useState("");
  const [trusted, setTrusted] = useState(false);
  const [pause, setPause] = useState(false);
  const probe = useMutation({ mutationFn: hostApi.probe, onSuccess: onQueued });
  const transfer = useMutation({
    mutationFn: hostApi.transfer,
    onSuccess: (queued) => {
      setSshPassword("");
      setNewPassword("");
      setPassword("");
      setRepeatPassword("");
      onQueued(queued);
      onClose();
    },
  });
  const verified =
    job?.id === probe.data?.id && job?.status === "succeeded" && job.host_key;
  const probing =
    probe.isPending ||
    (job?.id === probe.data?.id &&
      ["queued", "running"].includes(job?.status ?? ""));
  const ready =
    verified &&
    trusted &&
    pause &&
    sshPassword &&
    password &&
    newPassword.length >= 12 &&
    newPassword === repeatPassword;
  const error = transfer.error ?? probe.error;
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && !transfer.isPending) onClose();
      }}
      title="Transfer VPS"
      description={
        addressMoves
          ? "Automatically install Noted on another VPS and copy your content. Your address changes to one made from the new server's IP."
          : "Automatically install Noted on another VPS and copy your content. Keep the same domain."
      }
      className="host-dialog"
    >
      <form
        className="host-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready && job?.host_key)
            transfer.mutate({
              ip,
              port: Number(port),
              ssh_user: "root",
              ssh_password: sshPassword,
              host_key: job.host_key,
              owner_username: username,
              owner_password: newPassword,
              current_password: password,
              pause_confirmed: true,
            });
        }}
      >
        <p>
          Use an empty Ubuntu 24.04 or Debian 12/13 VPS with x86_64 architecture
          and root SSH password access. Noted installs Docker if needed.
          Existing Noted installations or occupied web ports are rejected.
        </p>
        <div className="host-fields">
          <label>
            Destination public IP
            <input
              aria-label="Destination public IP"
              value={ip}
              onChange={(event) => {
                setIp(event.target.value);
                probe.reset();
                setTrusted(false);
              }}
              required
            />
          </label>
          <label>
            SSH port
            <input
              aria-label="SSH port"
              type="number"
              min="1"
              max="65535"
              value={port}
              onChange={(event) => {
                setPort(event.target.value);
                probe.reset();
                setTrusted(false);
              }}
              required
            />
          </label>
        </div>
        <Button
          variant="secondary"
          type="button"
          disabled={!ip || !port || probing || transfer.isPending}
          onClick={() => probe.mutate({ ip, port: Number(port) })}
        >
          {probing ? "Reading host key..." : "Read SSH host key"}
        </Button>
        {addressMoves && ip.trim() && (
          <div className="transfer-new-address">
            <span>New address after the move</span>
            <CopyBox value={`https://${generatedDomain(ip)}`} />
            <p>
              Your current address is made from this server's IP, so it can't
              follow Noted to the new VPS. No DNS change is needed.
            </p>
          </div>
        )}
        {verified && (
          <div className="host-key">
            <code>{job.fingerprint}</code>
            <p>
              Compare this fingerprint with the destination provider’s console.
              Run <code>ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub</code>{" "}
              there.
            </p>
            <label className="check-label">
              <input
                type="checkbox"
                checked={trusted}
                onChange={(event) => setTrusted(event.target.checked)}
              />
              The fingerprint matches the destination VPS.
            </label>
          </div>
        )}
        {job?.id === probe.data?.id && job?.status === "failed" && (
          <Notice tone="error">{job.detail}</Notice>
        )}
        <label>
          Destination SSH user
          <input value="root" readOnly />
        </label>
        <label>
          Destination root password
          <input
            aria-label="Destination root password"
            type="password"
            autoComplete="off"
            value={sshPassword}
            onChange={(event) => setSshPassword(event.target.value)}
            required
            maxLength={1024}
          />
        </label>
        <h3>Owner on the new server</h3>
        <p>
          Set the login you will use after moving. These credentials are sent
          through verified SSH and are never included in the content ZIP.
        </p>
        <label>
          Destination owner username
          <input
            aria-label="Destination owner username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            minLength={1}
            maxLength={64}
            required
          />
        </label>
        <div className="host-fields">
          <label>
            Destination owner password
            <input
              aria-label="Destination owner password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              minLength={12}
              maxLength={256}
              required
            />
          </label>
          <label>
            Confirm destination password
            <input
              aria-label="Confirm destination password"
              type="password"
              autoComplete="new-password"
              value={repeatPassword}
              onChange={(event) => setRepeatPassword(event.target.value)}
              required
            />
          </label>
        </div>
        {repeatPassword && repeatPassword !== newPassword && (
          <Notice tone="error">The destination passwords do not match.</Notice>
        )}
        <ol className="host-instructions">
          <li>
            Noted provisions the destination and copies the application images.
          </li>
          <li>Source writes pause while all content and files are copied.</li>
          <li>
            When the destination is ready, change the existing Cloudflare A/AAAA
            record to its new IP. The domain itself stays the same.
          </li>
          <li>
            Wait for public HTTPS verification, then sign in with the
            destination owner login. Keep the source until you have checked your
            notes and files.
          </li>
        </ol>
        <label className="check-label">
          <input
            type="checkbox"
            checked={pause}
            onChange={(event) => setPause(event.target.checked)}
            required
          />
          {addressMoves
            ? "I understand that source writes stay paused until the new server is verified."
            : "I understand that source writes stay paused while I update DNS and verify the new server."}
        </label>
        <label>
          Current owner password
          <input
            aria-label="Current owner password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>
        {error && <Notice tone="error">{error.message}</Notice>}
        <div className="host-actions">
          <Button
            variant="secondary"
            type="button"
            onClick={onClose}
            disabled={transfer.isPending}
          >
            Cancel
          </Button>
          <Button disabled={!ready || transfer.isPending}>
            {transfer.isPending ? "Queuing transfer..." : "Start VPS transfer"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
