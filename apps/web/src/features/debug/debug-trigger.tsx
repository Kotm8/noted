import { lazy, Suspense, useRef, useState } from "react";
import { BrandIcon } from "../../components/ui/brand-icon";

const DebugDialog = lazy(() => import("./debug-dialog").then((module) => ({ default: module.DebugDialog })));

export function DebugTrigger() {
  const [open, setOpen] = useState(false);
  const burst = useRef({ count: 0, lastClick: 0 });

  function activate() {
    const now = performance.now();
    burst.current.count = now - burst.current.lastClick > 1500 ? 1 : burst.current.count + 1;
    burst.current.lastClick = now;
    if (burst.current.count === 7) {
      burst.current.count = 0;
      setOpen(true);
    }
  }

  return (
    <>
      <button type="button" className="rail-brand-trigger" aria-label="Noted" onClick={activate}>
        <BrandIcon className="rail-brand" decorative />
      </button>
      {open && <Suspense fallback={null}><DebugDialog open={open} onOpenChange={setOpen} /></Suspense>}
    </>
  );
}
