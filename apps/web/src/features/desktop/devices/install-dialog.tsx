import { useCallback, useEffect, useRef, useState } from "react";
import { Check, LoaderCircle } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Modal } from "../../../components/ui/dialog";
import { Notice } from "../../../components/ui/notice";
import { devicesApi, type Device, type InstallJob } from "./api";

const RETRY_SECONDS = 5;
const stages = [
  ["download", "Downloading from GitHub", "The release matching your server"],
  ["install", "Installing", "Your data on the device is kept"],
  [
    "cleanup",
    "Removing the downloaded file",
    "The temporary folder is cleaned up",
  ],
] as const;

function Unreachable({
  device,
  attempts,
  onRetry,
  onPairAgain,
}: {
  device: Device;
  attempts: number;
  onRetry: () => Promise<void>;
  onPairAgain: () => void;
}) {
  const [countdown, setCountdown] = useState(RETRY_SECONDS);
  const [trying, setTrying] = useState(false);
  const retry = useCallback(async () => {
    setTrying(true);
    await onRetry();
    setTrying(false);
    setCountdown(RETRY_SECONDS);
  }, [onRetry]);

  useEffect(() => {
    if (trying) return;
    const timer = window.setTimeout(() => {
      if (countdown <= 1) void retry();
      else setCountdown(countdown - 1);
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [countdown, trying, retry]);

  const usb = device.connection === "usb";
  return (
    <>
      <p className="device-unreachable-lead">
        It's {usb ? "set up for USB" : "paired"}, but Noted got no answer
        {attempts > 1 ? ` (tried ${attempts} times)` : ""}. Check these, and
        Noted will keep trying:
      </p>
      <ul className="device-checklist">
        {usb ? (
          <>
            <li>
              <strong>Plugged in</strong>
              <small>Use a cable that carries data, not only charging.</small>
            </li>
            <li>
              <strong>USB debugging still on</strong>
              <small>
                <b>Developer options › USB debugging</b>
              </small>
            </li>
          </>
        ) : (
          <>
            <li>
              <strong>VPN off</strong>
              <small>
                On this PC and the {device.kind}. A VPN sends local traffic
                away, so the PC can't see the {device.kind}.
              </small>
            </li>
            <li>
              <strong>Same Wi-Fi</strong>
              <small>
                The {device.kind} and this PC must be on the same network, not
                mobile data or a guest network.
              </small>
            </li>
            <li>
              <strong>Wireless debugging still on</strong>
              <small>
                Android turns it off when the {device.kind} restarts or changes
                Wi-Fi. <b>Developer options › Wireless debugging</b>
              </small>
            </li>
          </>
        )}
        <li>
          <strong>
            {device.kind === "watch" ? "Watch awake" : "Phone unlocked"}
          </strong>
          <small>
            Some devices drop the connection while the screen is off.
          </small>
        </li>
      </ul>
      <div className="device-waiting" role="status">
        <LoaderCircle size={16} className="spin" />
        <span>
          {trying ? "Trying to reach it…" : `Trying again in ${countdown} s`}
        </span>
      </div>
      <div className="dialog-actions">
        <Button type="button" variant="ghost" onClick={onPairAgain}>
          {usb ? "Connect again" : "Pair again"}
        </Button>
        <Button type="button" disabled={trying} onClick={() => void retry()}>
          Try again now
        </Button>
      </div>
    </>
  );
}

/**
 * Runs the desktop install job and follows its progress. If the device can't be
 * reached, it keeps retrying the connection and resumes the install on success.
 */
export function InstallDialog({
  device,
  commit,
  version,
  onClose,
  onPairAgain,
  onNext,
}: {
  device: Device;
  commit?: string;
  version: string | null;
  onClose: (installed: boolean) => void;
  onPairAgain: () => void;
  onNext?: () => void;
}) {
  const [job, setJob] = useState<InstallJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempts, setAttempts] = useState(1);
  const started = useRef(false);

  const start = useCallback(async () => {
    setError(null);
    setJob(null);
    try {
      await devicesApi.install(device.id, commit);
      setJob(await devicesApi.job());
    } catch (failure) {
      setError((failure as Error).message);
    }
  }, [device.id, commit]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void start();
  }, [start]);

  useEffect(() => {
    if (job?.status !== "running") return;
    const timer = window.setTimeout(() => {
      devicesApi
        .job()
        .then(setJob)
        .catch((failure: Error) => setError(failure.message));
    }, 400);
    return () => window.clearTimeout(timer);
  }, [job]);

  const retry = useCallback(async () => {
    try {
      await devicesApi.reconnect(device.id);
      await start();
    } catch {
      setAttempts((count) => count + 1);
    }
  }, [device.id, start]);

  const unreachable = job?.status === "failed" && job.unreachable;
  const done = job?.status === "done";
  const failed = (job?.status === "failed" && !job.unreachable) || error;
  const current = stages.findIndex(([stage]) => stage === job?.stage);

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && job?.status !== "running") onClose(done);
      }}
      title={
        unreachable
          ? `Can't reach your ${device.name}`
          : `Installing Noted ${job?.version || version || ""}`
      }
      description={
        unreachable
          ? "Noted couldn't connect to it."
          : `On ${device.name}. Keep it ${device.connection === "usb" ? "plugged in" : "on the same Wi-Fi"} until this finishes.`
      }
      className="device-dialog"
    >
      {unreachable ? (
        <Unreachable
          device={device}
          attempts={attempts}
          onRetry={retry}
          onPairAgain={onPairAgain}
        />
      ) : (
        <>
          <ol className="device-progress">
            {stages.map(([stage, title, detail], index) => {
              const state =
                done || index < current
                  ? "done"
                  : index === current
                    ? "active"
                    : "";
              return (
                <li key={stage} className={state}>
                  <span className="device-mark">
                    {state === "done" ? (
                      <Check size={12} />
                    ) : state === "active" && !failed ? (
                      <LoaderCircle size={12} className="spin" />
                    ) : null}
                  </span>
                  <span>
                    {stage === "install" ? `${title} on ${device.name}` : title}
                    <small>{detail}</small>
                    {stage === "download" && state === "active" && (
                      <span className="device-bar">
                        <i style={{ width: `${job?.progress ?? 0}%` }} />
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ol>
          {failed && <Notice tone="error">{error ?? job?.detail}</Notice>}
          {done && (
            <div className="device-finished" role="status">
              <Check size={16} />
              <span>
                Noted {job?.version} is on your {device.name}.{" "}
                {device.kind === "phone"
                  ? "Open it on the phone to connect to your server."
                  : "Open it on the watch to pair it with your phone."}
              </span>
            </div>
          )}
          {(done || failed) && (
            <div className="dialog-actions">
              {failed && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => void start()}
                >
                  Try again
                </Button>
              )}
              {done && onNext && (
                <Button type="button" variant="ghost" onClick={onNext}>
                  Install on watch next
                </Button>
              )}
              <Button type="button" onClick={() => onClose(Boolean(done))}>
                {done ? "Done" : "Close"}
              </Button>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
