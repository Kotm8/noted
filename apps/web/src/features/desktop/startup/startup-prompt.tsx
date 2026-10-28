import { Button } from "../../../components/ui/button";
import { Modal } from "../../../components/ui/dialog";
import { Notice } from "../../../components/ui/notice";
import { isDesktop } from "../connection-context";
import { useDesktopStartup } from "./use-desktop-startup";

/**
 * Asked once, in the workspace rather than the setup wizard: the wizard only
 * runs for people installing a server, not for those joining an existing one.
 */
export function StartupPrompt() {
  if (!isDesktop) return null;
  return <Prompt />;
}

function Prompt() {
  const { query, change } = useDesktopStartup();
  if (!query.data || query.data.asked) return null;
  const choose = (enabled: boolean, minimized = false) =>
    change.mutate({ enabled, minimized, asked: true });
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && !change.isPending) choose(false);
      }}
      title="Start Noted with Windows?"
      description="Noted opens when you sign in, so reminders and the tracker are ready. You can change this later in Settings › Desktop app."
    >
      {change.error && <Notice tone="error">{change.error.message}</Notice>}
      <div className="dialog-actions">
        <Button
          variant="ghost"
          disabled={change.isPending}
          onClick={() => choose(false)}
        >
          Not now
        </Button>
        <Button
          variant="secondary"
          disabled={change.isPending}
          onClick={() => choose(true)}
        >
          Yes
        </Button>
        <Button disabled={change.isPending} onClick={() => choose(true, true)}>
          Yes, minimized
        </Button>
      </div>
    </Modal>
  );
}
