import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Check, CircleAlert, Copy, RefreshCw, RotateCw, Smartphone } from "lucide-react";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Modal } from "../../components/ui/dialog";
import { Notice } from "../../components/ui/notice";
import { supportsPush } from "../notifications/browser";
import { collectDiagnostics, testDeviceNotification, testPhoneNotification } from "./diagnostics";

export function DebugDialog({ open, onOpenChange }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const client = useQueryClient();
  const report = useQuery({
    queryKey: ["debug-diagnostics"],
    queryFn: collectDiagnostics,
    enabled: open,
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; failed: boolean } | null>(null);
  async function run<T>(action: () => Promise<T>, message: string | ((result: T) => string)) {
    setBusy(true);
    setFeedback(null);
    try {
      const result = await action();
      setFeedback({ message: typeof message === "string" ? message : message(result), failed: false });
    } catch (error) {
      setFeedback({ message: error instanceof Error ? error.message : "The action failed.", failed: true });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Diagnostics"
      description="Connection checks and tools for this device." className="debug-dialog">
      <div className="debug-toolbar">
        <span>{report.data?.client ?? "Checking client"}</span>
        <Button variant="ghost" size="small" disabled={report.isFetching}
          onClick={() => void report.refetch()}>
          <RefreshCw size={14} />{report.isFetching ? "Checking..." : "Run checks"}
        </Button>
      </div>
      {report.isPending && <p role="status">Checking connection and notification status...</p>}
      {report.isError && <Notice tone="error">Could not collect diagnostics. Try running checks again.</Notice>}
      {report.data && (
        <dl className="debug-checks" aria-label="Diagnostic results" aria-busy={report.isFetching}>
          {report.data.checks.map((check) => (
            <div key={check.label}>
              <dt>{check.label}</dt>
              <dd data-state={check.state}>
                {check.state === "ok" ? <Check size={14} aria-label="Passed" /> : <CircleAlert size={14} aria-label={check.state === "error" ? "Failed" : "Attention"} />}
                <span>{check.value}</span>
              </dd>
            </div>
          ))}
        </dl>
      )}
      <div className="debug-actions">
        <Button variant="secondary" disabled={busy}
          onClick={() => void run(testPhoneNotification, (message) => message)}>
          <Smartphone size={15} />Send test to phone
        </Button>
        <Button variant="secondary" disabled={busy || !report.data || report.isFetching}
          onClick={() => void run(() => navigator.clipboard.writeText(JSON.stringify(report.data, null, 2)), "Report copied.")}>
          <Copy size={15} />Copy report
        </Button>
        <Button variant="secondary" disabled={busy || !supportsPush()}
          onClick={() => void run(testDeviceNotification, "Local notification sent. This does not test server delivery.")}>
          <Bell size={15} />Test this device
        </Button>
        <Button variant="secondary" disabled={busy}
          onClick={() => void run(() => client.invalidateQueries({ predicate: (query) => query.queryKey[0] !== "debug-diagnostics" }, { throwOnError: true }), "App data refreshed.")}>
          <RefreshCw size={15} />Refresh app data
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => window.location.reload()}>
          <RotateCw size={15} />Reload client
        </Button>
      </div>
      {feedback && <Notice tone={feedback.failed ? "error" : "info"}>{feedback.message}</Notice>}
      <p className="debug-footnote">Phone tests use server push and ignore desktop focus. Device tests run locally. Reports exclude credentials, note contents, and push tokens.</p>
    </Modal>
  );
}
