import { LoaderCircle } from "lucide-react";
import { BrandIcon } from "./ui/brand-icon";
import { SwitchServerButton } from "../features/desktop/switch-server-button";
import { Button } from "./ui/button";
import { Notice } from "./ui/notice";

interface ConnectionScreenProps {
  error?: string;
  onRetry?: () => void;
}

export function ConnectionScreen({ error, onRetry }: ConnectionScreenProps) {
  return (
    <main className="connection-screen">
      <BrandIcon />
      {error ? (
        <>
          <h1>Let's reconnect.</h1>
          <Notice tone="error">{error}</Notice>
          <Button onClick={onRetry}>Try again</Button>
        </>
      ) : (
        <>
          <LoaderCircle size={23} className="animate-spin" />
          <p>Finding your space...</p>
        </>
      )}
      <SwitchServerButton />
    </main>
  );
}
