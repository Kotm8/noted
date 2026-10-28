import { useEffect, useState } from "react";
import { Cable, Check, Info, LoaderCircle, Wifi } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Modal } from "../../../components/ui/dialog";
import { Notice } from "../../../components/ui/notice";
import { devicesApi, type Device, type DeviceKind } from "./api";

const developerOptions = {
  phone: (
    <li>
      <strong>Turn on Developer options</strong>
      <small>
        Once per phone. <b>Settings › About phone › Software information</b>,
        then tap <b>Build number</b> 7 times.
      </small>
    </li>
  ),
  watch: (
    <li>
      <strong>Turn on Developer options</strong>
      <small>
        Once per watch. <b>Settings › About watch › Software</b>, then tap{" "}
        <b>Software version</b> 5 times.
      </small>
    </li>
  ),
};

function UsbSteps() {
  return (
    <>
      {developerOptions.phone}
      <li>
        <strong>Turn on USB debugging</strong>
        <small>
          <b>Settings › Developer options › USB debugging</b>
        </small>
      </li>
      <li>
        <strong>Plug the phone into this PC</strong>
        <small>
          On the phone, tap <b>Allow</b> on “Allow USB debugging?” and tick
          “Always allow from this computer”.
        </small>
      </li>
    </>
  );
}

function WifiSteps({
  kind,
  address,
  code,
  setAddress,
  setCode,
}: {
  kind: DeviceKind;
  address: string;
  code: string;
  setAddress: (value: string) => void;
  setCode: (value: string) => void;
}) {
  return (
    <>
      {developerOptions[kind]}
      <li>
        <strong>Turn on Wireless debugging</strong>
        <small>
          <b>
            Settings › Developer options ›{" "}
            {kind === "watch" ? "ADB debugging and " : ""}Wireless debugging
          </b>
        </small>
      </li>
      <li>
        <strong>Pair with a code</strong>
        <small>
          Tap{" "}
          <b>
            {kind === "watch"
              ? "Pair new device"
              : "Pair device with pairing code"}
          </b>{" "}
          and type what it shows:
        </small>
        <div className="device-pair-fields">
          <label>
            IP address and port
            <input
              value={address}
              placeholder="192.168.1.23:37199"
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setAddress(event.target.value)}
            />
          </label>
          <label>
            Pairing code
            <input
              value={code}
              placeholder="6 digits"
              inputMode="numeric"
              maxLength={6}
              autoComplete="off"
              onChange={(event) =>
                setCode(event.target.value.replace(/\D/g, ""))
              }
            />
          </label>
        </div>
      </li>
    </>
  );
}

/**
 * Walks through enabling debugging and connects a phone (USB or Wi-Fi) or a
 * watch (Wi-Fi only: watch chargers carry no data).
 */
export function ConnectDialog({
  kind,
  version,
  onClose,
  onInstall,
}: {
  kind: DeviceKind;
  version: string | null;
  onClose: () => void;
  onInstall: (device: Device) => void;
}) {
  const [method, setMethod] = useState<"usb" | "wifi">(
    kind === "phone" ? "usb" : "wifi",
  );
  const [address, setAddress] = useState("");
  const [code, setCode] = useState("");
  const [waiting, setWaiting] = useState<"device" | "unauthorized">("device");
  const [device, setDevice] = useState<Device | null>(null);
  const [pairing, setPairing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (method !== "usb" || device) return;
    let active = true;
    const look = async () => {
      try {
        const result = await devicesApi.detectUsb();
        if (!active) return;
        if ("id" in result) setDevice(result);
        else setWaiting(result.waiting);
        setError(null);
      } catch (failure) {
        if (active) setError((failure as Error).message);
      }
    };
    void look();
    const timer = window.setInterval(() => void look(), 2000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [method, device]);

  async function pair() {
    setPairing(true);
    setError(null);
    try {
      setDevice(await devicesApi.pair(address, code));
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setPairing(false);
    }
  }

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={`Connect your ${kind}`}
      description="Takes a minute the first time. After that, updates are one click."
      className="device-dialog"
    >
      {kind === "phone" ? (
        <>
          <div className="device-method" role="group" aria-label="Connection">
            <button
              type="button"
              aria-pressed={method === "usb"}
              onClick={() => {
                setMethod("usb");
                setError(null);
              }}
            >
              <Cable size={15} />
              USB cable
            </button>
            <button
              type="button"
              aria-pressed={method === "wifi"}
              onClick={() => {
                setMethod("wifi");
                setError(null);
              }}
            >
              <Wifi size={15} />
              Wi-Fi
            </button>
          </div>
          <p className="device-method-note">
            {method === "usb"
              ? "Simplest for the first time. Windows may need Samsung's USB driver for a Samsung phone."
              : "No cable needed. The phone and this PC must be on the same Wi-Fi."}
          </p>
        </>
      ) : (
        <p className="device-method-note">
          <Info size={13} />
          Watches connect over Wi-Fi only: their charger has no data connection.
          The watch and this PC must be on the same Wi-Fi.
        </p>
      )}
      <ol className="device-steps">
        {method === "usb" ? (
          <UsbSteps />
        ) : (
          <WifiSteps
            kind={kind}
            address={address}
            code={code}
            setAddress={setAddress}
            setCode={setCode}
          />
        )}
      </ol>
      {error && <Notice tone="error">{error}</Notice>}
      {device ? (
        <div className="device-waiting found" role="status">
          <Check size={16} />
          <span>
            Connected to <b>{device.name}</b>
            {device.kind !== kind ? ` (a ${device.kind})` : ""}
          </span>
        </div>
      ) : method === "usb" ? (
        <div className="device-waiting" role="status">
          <LoaderCircle size={16} className="spin" />
          <span>
            {waiting === "unauthorized"
              ? "Tap Allow on the phone's “Allow USB debugging?” prompt…"
              : "Waiting for your phone…"}
          </span>
        </div>
      ) : null}
      <div className="dialog-actions">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        {method === "wifi" && !device ? (
          <Button
            type="button"
            disabled={pairing || !address.trim() || code.length !== 6}
            onClick={() => void pair()}
          >
            {pairing && <LoaderCircle size={15} className="spin" />}
            {pairing ? "Pairing…" : "Pair"}
          </Button>
        ) : (
          <Button
            type="button"
            disabled={!device || !version}
            onClick={() => device && onInstall(device)}
          >
            Install Noted {version ?? ""}
          </Button>
        )}
      </div>
    </Modal>
  );
}
