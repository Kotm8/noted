import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { useState } from "react";
import { Info } from "lucide-react";
import {
  devicesApi,
  devicesKey,
  type ReleaseTarget,
} from "../../desktop/devices/api";
import { DevicesSection } from "../../desktop/devices/devices-section";

export type DeviceChoice = "install" | "skip";

interface Props {
  choice: DeviceChoice;
  setChoice: (choice: DeviceChoice) => void;
  release: ReleaseTarget;
}

/** The setup wizard runs before the app's providers exist, so it brings its own query client. */
export function PhoneWatchStep(props: Props) {
  const [client] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={client}>
      <Choices {...props} />
    </QueryClientProvider>
  );
}

function Choices({ choice, setChoice, release }: Props) {
  const overview = useQuery({
    queryKey: devicesKey,
    queryFn: devicesApi.overview,
  });
  const tool = overview.data?.tool;
  return (
    <section className="installation-step phone-watch-step">
      <h1>Phone and watch apps</h1>
      <p>
        Noted can install the Android app on your phone and watch from this PC,
        and keep them on the same version as your server. To do that it needs
        Android's install tool.
      </p>
      <div
        className="setup-choices"
        role="radiogroup"
        aria-label="Install tool"
      >
        <label className="setup-choice">
          <input
            type="radio"
            name="device-tool"
            checked={choice === "install"}
            onChange={() => setChoice("install")}
          />
          {tool?.ready ? (
            <span>
              <strong>Use the install tool on this PC</strong>
              <small>
                {tool.source === "existing"
                  ? "Found Android's adb in the Android SDK on this PC. Nothing to download."
                  : "Already downloaded. Nothing more to fetch."}
              </small>
            </span>
          ) : (
            <span>
              <strong>Download it from Google</strong>
              <small>
                Android's <code>adb</code> tool, about 7 MB, straight from{" "}
                <code>dl.google.com</code>. Google's Android SDK terms apply.
              </small>
            </span>
          )}
        </label>
        <label className="setup-choice">
          <input
            type="radio"
            name="device-tool"
            checked={choice === "skip"}
            onChange={() => setChoice("skip")}
          />
          <span>
            <strong>Skip for now</strong>
            <small>
              You can set this up later in Settings › Devices, the first time
              you connect a phone or watch.
            </small>
          </span>
        </label>
      </div>
      {choice === "skip" ? (
        <p className="setup-help">
          <Info size={14} /> Whenever you're ready, open{" "}
          <strong>Settings › Devices</strong> to connect them by USB cable or
          Wi-Fi.
        </p>
      ) : (
        <div className="setup-devices">
          <h4>
            Install now <small>optional</small>
          </h4>
          <p className="setup-help">
            Connect your phone and watch to install Noted {release.version} on
            them now, or continue and do it later in{" "}
            <strong>Settings › Devices</strong>.
          </p>
          <DevicesSection target={release} showTool={false} />
        </div>
      )}
    </section>
  );
}
