import { StartupLogo } from "./startup-logo";
import { SwitchServerButton } from "../features/desktop/switch-server-button";
import { ServerAddressPanel } from "../features/desktop/server-address-panel";
import { Button } from "./ui/button";
import { Notice } from "./ui/notice";

interface ConnectionScreenProps {
  error?: string;
  onRetry?: () => void;
}

export function ConnectionScreen({ error, onRetry }: ConnectionScreenProps) {
  return (
    <main className="connection-screen">
      <StartupLogo />
      {error ? (
        <>
          <h1>Let's reconnect.</h1>
          <Notice tone="error">{error}</Notice>
          <Button onClick={onRetry}>Try again</Button>
          <ServerAddressPanel />
        </>
      ) : (
        <>
          <div
            className="startup-progress"
            role="progressbar"
            aria-label="Connecting to your server"
          />
        </>
      )}
      <SwitchServerButton />
    </main>
  );
}
